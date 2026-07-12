package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPreparePortableWebViewProfileMigratesLegacyDataOnce(t *testing.T) {
	root := t.TempDir()
	legacy := filepath.Join(root, "user-data", "browser", "Default", "Local Storage", "leveldb")
	if err := os.MkdirAll(legacy, 0o755); err != nil {
		t.Fatal(err)
	}
	legacyFile := filepath.Join(legacy, "000152.log")
	if err := os.WriteFile(legacyFile, []byte("model-config"), 0o644); err != nil {
		t.Fatal(err)
	}

	profileRoot, err := preparePortableWebViewProfile(root)
	if err != nil {
		t.Fatal(err)
	}
	migratedFile := filepath.Join(profileRoot, "EBWebView", "Default", "Local Storage", "leveldb", "000152.log")
	contents, err := os.ReadFile(migratedFile)
	if err != nil || string(contents) != "model-config" {
		t.Fatalf("legacy model config was not migrated: %q %v", contents, err)
	}

	if err := os.WriteFile(migratedFile, []byte("new-data"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := preparePortableWebViewProfile(root); err != nil {
		t.Fatal(err)
	}
	contents, _ = os.ReadFile(migratedFile)
	if string(contents) != "new-data" {
		t.Fatalf("existing WebView2 data was overwritten: %q", contents)
	}
}
