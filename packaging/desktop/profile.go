package main

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// WebView2 appends EBWebView to the configured data directory. The legacy
// Portable launched Edge with user-data/browser directly, so copy that profile
// once into browser/EBWebView before the first desktop start.
func preparePortableWebViewProfile(root string) (string, error) {
	profileRoot := filepath.Join(root, "user-data", "browser")
	target := filepath.Join(profileRoot, "EBWebView")
	marker := filepath.Join(target, ".storyforge-legacy-profile-migrated")
	if _, err := os.Stat(marker); err == nil {
		return profileRoot, nil
	}
	if _, err := os.Stat(filepath.Join(profileRoot, "Default")); errors.Is(err, os.ErrNotExist) {
		if mkdirErr := os.MkdirAll(target, 0o755); mkdirErr != nil {
			return "", mkdirErr
		}
		if writeErr := os.WriteFile(marker, []byte("new-profile\n"), 0o644); writeErr != nil {
			return "", writeErr
		}
		return profileRoot, nil
	}

	if err := os.MkdirAll(target, 0o755); err != nil {
		return "", err
	}
	entries, err := os.ReadDir(profileRoot)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if strings.EqualFold(entry.Name(), "EBWebView") || shouldSkipProfileEntry(entry.Name()) {
			continue
		}
		if err := copyProfilePath(
			filepath.Join(profileRoot, entry.Name()),
			filepath.Join(target, entry.Name()),
		); err != nil {
			return "", err
		}
	}
	if err := os.WriteFile(marker, []byte("legacy-profile\n"), 0o644); err != nil {
		return "", err
	}
	return profileRoot, nil
}

func shouldSkipProfileEntry(name string) bool {
	switch strings.ToLower(name) {
	case "singletoncookie", "singletonlock", "singletonsocket", "lockfile", "devtoolsactiveport":
		return true
	default:
		return false
	}
}

func copyProfilePath(source, target string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil
	}
	if info.IsDir() {
		if err := os.MkdirAll(target, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if shouldSkipProfileEntry(entry.Name()) {
				continue
			}
			if err := copyProfilePath(filepath.Join(source, entry.Name()), filepath.Join(target, entry.Name())); err != nil {
				if errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrPermission) {
					continue
				}
				return err
			}
		}
		return nil
	}

	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, info.Mode().Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}
