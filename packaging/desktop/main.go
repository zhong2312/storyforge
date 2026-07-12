package main

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/logger"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

var appVersion = "3.7.5"

const (
	desktopChildArgument = "--storyforge-desktop-child"
	stableChildUptime    = time.Minute
	maxCrashRestarts     = 3
)

// The portable builder replaces web with the current Vite dist at compile time.
//
//go:embed all:web
var embeddedAssets embed.FS

func main() {
	if !hasArgument(desktopChildArgument) {
		if err := superviseDesktop(); err != nil {
			writeSupervisorLog("desktop supervisor stopped: %v", err)
		}
		return
	}

	if err := runDesktop(); err != nil {
		log.Printf("desktop event loop failed: %v", err)
		os.Exit(1)
	}
}

// superviseDesktop keeps the native host alive when Wails terminates the
// process after a WebView2 browser-process failure. A normal window close
// returns exit code 0 and stops the supervisor together with the UI.
func superviseDesktop() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}

	consecutiveCrashes := 0
	for {
		startedAt := time.Now()
		command := exec.Command(executable, desktopChildArguments(os.Args[1:])...)
		command.Dir = filepath.Dir(executable)
		err = command.Run()
		uptime := time.Since(startedAt)
		if err == nil {
			writeSupervisorLog("desktop child closed normally")
			return nil
		}

		consecutiveCrashes, shouldRestart := nextRestartAttempt(uptime, consecutiveCrashes)
		writeSupervisorLog(
			"desktop child exited unexpectedly after %s (attempt %d/%d): %v",
			uptime.Round(time.Second), consecutiveCrashes, maxCrashRestarts, err,
		)
		if !shouldRestart {
			return fmt.Errorf("desktop child crashed %d times: %w", consecutiveCrashes, err)
		}
		time.Sleep(time.Second)
	}
}

func runDesktop() error {
	assets, err := fs.Sub(embeddedAssets, "web")
	if err != nil {
		panic(err)
	}

	executable, err := os.Executable()
	if err != nil {
		panic(err)
	}
	root := filepath.Dir(executable)
	userDataDir := filepath.Join(root, "user-data")
	if err := os.MkdirAll(userDataDir, 0o755); err != nil {
		panic(err)
	}
	logPath := filepath.Join(userDataDir, "storyforge-desktop.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err == nil {
		defer logFile.Close()
		log.SetOutput(logFile)
	}
	log.Printf("starting StoryForge desktop v%s", appVersion)

	profileDir, err := preparePortableWebViewProfile(root)
	if err != nil {
		log.Printf("profile migration failed: %v", err)
		panic(err)
	}

	desktopServer := newDesktopServer(defaultListenAddr, assets)
	var appContext context.Context
	var redirectOnce sync.Once

	err = wails.Run(&options.App{
		Title:       fmt.Sprintf("StoryForge v%s", appVersion),
		Width:       1440,
		Height:      900,
		MinWidth:    1024,
		MinHeight:   700,
		StartHidden: hasArgument("--no-window"),
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Middleware: desktopAssetMiddleware(desktopServer.Handler()),
		},
		BackgroundColour: options.NewRGB(247, 244, 238),
		Logger:           logger.NewFileLogger(logPath),
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "storyforge-desktop-zhong2312-v1",
			OnSecondInstanceLaunch: func(_ options.SecondInstanceData) {
				if appContext != nil {
					wailsruntime.WindowUnminimise(appContext)
					wailsruntime.WindowShow(appContext)
				}
			},
		},
		OnStartup: func(ctx context.Context) {
			appContext = ctx
			log.Printf("desktop window started; profile=%s", profileDir)
			if startErr := desktopServer.Start(); startErr != nil {
				log.Printf("desktop server failed: %v", startErr)
				_, _ = wailsruntime.MessageDialog(ctx, wailsruntime.MessageDialogOptions{
					Type:    wailsruntime.ErrorDialog,
					Title:   "StoryForge 启动失败",
					Message: fmt.Sprintf("内置 AI 代理无法启动：%v\n\n请关闭旧版 StoryForge 后重试。", startErr),
				})
				wailsruntime.Quit(ctx)
			}
		},
		OnDomReady: func(ctx context.Context) {
			redirectOnce.Do(func() {
				wailsruntime.WindowExecJS(ctx, `location.replace("http://127.0.0.1:17831/storyforge/?storyforge-test=1")`)
			})
		},
		OnShutdown: func(context.Context) {
			log.Printf("desktop window shutdown requested")
			desktopServer.Close()
		},
		Windows: &windows.Options{
			WebviewUserDataPath: profileDir,
			Theme:               windows.SystemDefault,
			// Keep the WebView aligned to the native title bar. Mica can add a second
			// non-client inset on some Windows DPI/window-size combinations.
			BackdropType:         windows.None,
			IsZoomControlEnabled: true,
			Messages: &windows.Messages{
				InstallationRequired: "StoryForge 需要 Microsoft Edge WebView2 Runtime。是否立即下载安装？",
				UpdateRequired:       "StoryForge 需要更新 Microsoft Edge WebView2 Runtime。是否立即更新？",
				MissingRequirements:  "缺少桌面运行组件",
				Webview2NotInstalled: "未安装 WebView2 Runtime",
				Error:                "StoryForge 桌面端错误",
				FailedToInstall:      "WebView2 Runtime 安装失败，请从 Microsoft 官方页面手动安装。",
				DownloadPage:         "StoryForge 不使用 IE，需要 WebView2 Runtime。是否打开官方下载页面？最低版本：",
				PressOKToInstall:     "点击确定安装 WebView2 Runtime。",
				ContactAdmin:         "请联系管理员安装 WebView2 Runtime。",
				InvalidFixedWebview2: "WebView2 Runtime 路径无效。",
				WebView2ProcessCrash: "WebView2 进程异常退出，请重新启动 StoryForge。",
			},
		},
	})
	if err != nil {
		return err
	}
	log.Printf("desktop event loop stopped")
	return nil
}

func desktopChildArguments(arguments []string) []string {
	result := make([]string, 0, len(arguments)+1)
	for _, argument := range arguments {
		if argument != desktopChildArgument {
			result = append(result, argument)
		}
	}
	return append(result, desktopChildArgument)
}

func nextRestartAttempt(uptime time.Duration, consecutiveCrashes int) (int, bool) {
	if uptime >= stableChildUptime {
		consecutiveCrashes = 0
	}
	consecutiveCrashes++
	return consecutiveCrashes, consecutiveCrashes < maxCrashRestarts
}

func writeSupervisorLog(format string, arguments ...any) {
	executable, err := os.Executable()
	if err != nil {
		return
	}
	userDataDir := filepath.Join(filepath.Dir(executable), "user-data")
	if err := os.MkdirAll(userDataDir, 0o755); err != nil {
		return
	}
	logFile, err := os.OpenFile(
		filepath.Join(userDataDir, "storyforge-desktop.log"),
		os.O_CREATE|os.O_APPEND|os.O_WRONLY,
		0o644,
	)
	if err != nil {
		return
	}
	defer logFile.Close()
	log.New(logFile, "", log.LstdFlags).Printf(format, arguments...)
}

func hasArgument(expected string) bool {
	for _, argument := range os.Args[1:] {
		if argument == expected {
			return true
		}
	}
	return false
}
