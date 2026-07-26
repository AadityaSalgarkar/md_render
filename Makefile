APP_NAME := MD_RENDER
BIN_NAME := md-render
UNAME_S := $(shell uname -s)

APP_BUNDLE := src-tauri/target/release/bundle/macos/$(APP_NAME).app
LINUX_BIN := src-tauri/target/release/$(BIN_NAME)
APPLICATIONS_DIR ?= /Applications
BIN_DIR ?= $(HOME)/bin
WRAPPER := bin/mdrender

# Linux installs into the user's home by default; no root required.
PREFIX ?= $(HOME)/.local
DESKTOP_DIR := $(PREFIX)/share/applications
ICON_DIR := $(PREFIX)/share/icons/hicolor
DESKTOP_TEMPLATE := linux/$(BIN_NAME).desktop.in

.DEFAULT_GOAL := help

.PHONY: help build install install-macos install-linux install-clean test clean

help:
	@printf "Targets:\n"
	@printf "  make build          Build the Tauri app for the current platform\n"
	@printf "  make install        Build and install for the current platform ($(UNAME_S))\n"
	@printf "  make install-macos  Install MD_RENDER.app plus ~/bin/mdrender\n"
	@printf "  make install-linux  Install into \$$PREFIX (default ~/.local), no root needed\n"
	@printf "  make install-clean  Install, then remove local build artifacts\n"
	@printf "  make test           Run the frontend test suite\n"
	@printf "  make clean          Remove local build artifacts\n"

build:
	npm run tauri:build

test:
	npm test -- --run

ifeq ($(UNAME_S),Darwin)
install: install-macos
else
install: install-linux
endif

install-macos: build
	test -d "$(APP_BUNDLE)"
	rm -rf "$(APPLICATIONS_DIR)/$(APP_NAME).app"
	cp -R "$(APP_BUNDLE)" "$(APPLICATIONS_DIR)/"
	mkdir -p "$(BIN_DIR)"
	cp "$(WRAPPER)" "$(BIN_DIR)/mdrender"
	chmod +x "$(BIN_DIR)/mdrender"
	@echo "Installed $(APP_NAME).app to $(APPLICATIONS_DIR)"
	@echo "Installed mdrender wrapper to $(BIN_DIR)/mdrender"

install-linux: build
	test -x "$(LINUX_BIN)"
	mkdir -p "$(PREFIX)/bin" "$(BIN_DIR)" "$(DESKTOP_DIR)"
	install -m 755 "$(LINUX_BIN)" "$(PREFIX)/bin/$(BIN_NAME)"
	install -m 755 "$(WRAPPER)" "$(BIN_DIR)/mdrender"
	@# Desktop entry points at the absolute path so it works regardless of PATH.
	sed 's|@EXEC@|$(PREFIX)/bin/$(BIN_NAME)|' "$(DESKTOP_TEMPLATE)" \
		> "$(DESKTOP_DIR)/$(BIN_NAME).desktop"
	chmod 644 "$(DESKTOP_DIR)/$(BIN_NAME).desktop"
	mkdir -p "$(ICON_DIR)/32x32/apps" "$(ICON_DIR)/128x128/apps" "$(ICON_DIR)/256x256/apps"
	install -m 644 src-tauri/icons/32x32.png "$(ICON_DIR)/32x32/apps/$(BIN_NAME).png"
	install -m 644 src-tauri/icons/128x128.png "$(ICON_DIR)/128x128/apps/$(BIN_NAME).png"
	install -m 644 "src-tauri/icons/128x128@2x.png" "$(ICON_DIR)/256x256/apps/$(BIN_NAME).png"
	-update-desktop-database "$(DESKTOP_DIR)" 2>/dev/null
	-xdg-mime default "$(BIN_NAME).desktop" text/markdown 2>/dev/null
	-gtk-update-icon-cache -f -t "$(ICON_DIR)" 2>/dev/null
	@echo "Installed $(BIN_NAME) to $(PREFIX)/bin/$(BIN_NAME)"
	@echo "Installed mdrender wrapper to $(BIN_DIR)/mdrender"
	@echo "Installed desktop entry to $(DESKTOP_DIR)/$(BIN_NAME).desktop"
	@echo "Ensure $(PREFIX)/bin and $(BIN_DIR) are on your PATH."

install-clean: install clean

clean:
	rm -rf dist src-tauri/target
