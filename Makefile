APP_NAME := MD_RENDER
APP_BUNDLE := src-tauri/target/release/bundle/macos/$(APP_NAME).app
APPLICATIONS_DIR ?= /Applications
BIN_DIR ?= $(HOME)/bin
WRAPPER := bin/mdrender

.DEFAULT_GOAL := help

.PHONY: help build install install-macos install-clean clean

help:
	@printf "Targets:\n"
	@printf "  make build          Build the macOS Tauri app bundle\n"
	@printf "  make install        Build and install MD_RENDER.app plus ~/bin/mdrender\n"
	@printf "  make install-clean  Install, then remove local build artifacts\n"
	@printf "  make clean          Remove local build artifacts\n"

build:
	npm run tauri:build

install install-macos: build
	test -d "$(APP_BUNDLE)"
	rm -rf "$(APPLICATIONS_DIR)/$(APP_NAME).app"
	cp -R "$(APP_BUNDLE)" "$(APPLICATIONS_DIR)/"
	mkdir -p "$(BIN_DIR)"
	cp "$(WRAPPER)" "$(BIN_DIR)/mdrender"
	chmod +x "$(BIN_DIR)/mdrender"
	@echo "Installed $(APP_NAME).app to $(APPLICATIONS_DIR)"
	@echo "Installed mdrender wrapper to $(BIN_DIR)/mdrender"

install-clean: install clean

clean:
	rm -rf dist src-tauri/target
