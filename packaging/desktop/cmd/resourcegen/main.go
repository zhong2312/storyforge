package main

import (
	"flag"
	"fmt"
	_ "image/png"
	"os"

	"github.com/leaanthony/winicon"
	"github.com/tc-hib/winres"
)

func main() {
	inputPath := flag.String("input", "", "source PNG path")
	outputPath := flag.String("output", "", "target Windows .syso path")
	flag.Parse()
	if *inputPath == "" || *outputPath == "" {
		fatalf("input and output are required")
	}

	input, err := os.Open(*inputPath)
	if err != nil {
		fatalf("open source icon: %v", err)
	}
	defer input.Close()

	icoFile, err := os.CreateTemp("", "storyforge-icon-*.ico")
	if err != nil {
		fatalf("create temporary ICO: %v", err)
	}
	icoPath := icoFile.Name()
	defer os.Remove(icoPath)
	if err := winicon.GenerateIcon(input, icoFile, []int{256, 128, 64, 48, 32, 16}); err != nil {
		fatalf("generate ICO: %v", err)
	}
	if err := icoFile.Close(); err != nil {
		fatalf("close temporary ICO: %v", err)
	}

	icoFile, err = os.Open(icoPath)
	if err != nil {
		fatalf("reopen temporary ICO: %v", err)
	}
	defer icoFile.Close()
	ico, err := winres.LoadICO(icoFile)
	if err != nil {
		fatalf("load generated ICO: %v", err)
	}

	resources := winres.ResourceSet{}
	if err := resources.SetIcon(winres.RT_ICON, ico); err != nil {
		fatalf("set executable icon: %v", err)
	}
	output, err := os.Create(*outputPath)
	if err != nil {
		fatalf("create resource object: %v", err)
	}
	defer output.Close()
	if err := resources.WriteObject(output, winres.ArchAMD64); err != nil {
		fatalf("write resource object: %v", err)
	}
}

func fatalf(format string, arguments ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", arguments...)
	os.Exit(1)
}
