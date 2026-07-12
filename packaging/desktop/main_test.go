package main

import (
	"reflect"
	"testing"
	"time"
)

func TestDesktopChildArgumentsPreservesArgumentsAndAddsMarkerOnce(t *testing.T) {
	actual := desktopChildArguments([]string{"--no-window", desktopChildArgument})
	expected := []string{"--no-window", desktopChildArgument}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("desktopChildArguments() = %#v, want %#v", actual, expected)
	}
}

func TestNextRestartAttemptResetsAfterStableRun(t *testing.T) {
	attempt, shouldRestart := nextRestartAttempt(stableChildUptime, maxCrashRestarts-1)
	if attempt != 1 || !shouldRestart {
		t.Fatalf("stable child restart = (%d, %t), want (1, true)", attempt, shouldRestart)
	}
}

func TestNextRestartAttemptStopsCrashLoop(t *testing.T) {
	attempt, shouldRestart := nextRestartAttempt(time.Second, maxCrashRestarts-1)
	if attempt != maxCrashRestarts || shouldRestart {
		t.Fatalf("crash-loop restart = (%d, %t), want (%d, false)", attempt, shouldRestart, maxCrashRestarts)
	}
}
