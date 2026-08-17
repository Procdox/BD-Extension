
# Overview
Adds support for Blackdoor's scripting language.

The game can be found here: https://store.steampowered.com/app/4562430/Blackdoor/

There is not yet a way to interact with the game client directly, so moving scripts must be done manually via copy/paste.

## Features
- Syntax highlighting
- Hover tooltips for API functions
- Hover tooltips for object properties
- Syntax linting and type deduction
- Problem indicators for invalid syntax or type mismatches
- Go-To Declaration

## Setup from Source
- If you haven't already, install npm
- Download this project and open it in VSCode
- In the VSCode terminal, run `npm install` to setup the project dependencies
- Compile this project via the menu option `Terminal -> Run Build Task` or keyboard shortcut `Ctrl + Shift + B`
- Launch a debug session via the menu option `Run -> Start Debugging` or keyboard shortcut `F5`
- This will launch a second VSCode window with the extension installed temporarily. The extension will activate for any file with a `.bd` extension.

## Todo
- add detection for function/variable shadowing builtin/api
- add detection for leaked flow statement variable use
- add detection for redeclaration within scope
- add dynamic import statement support
- add list append/insert type deduction