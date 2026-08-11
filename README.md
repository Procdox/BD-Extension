
# Overview
Adds support for Blackdoor's scripting language.

The game can be found here: https://store.steampowered.com/app/4562430/Blackdoor/

## Features
- Syntax highlighting
- Hover tooltips for API functions
- Hover tooltips for object properties
- Syntax linting and type deduction
- Problem indicators for invalid syntax or type mismatches
- Go-To Declaration

## Setup from Source
- Run `npm install` in the terminal
- Compile the project with the `npm: compile` vscode task
- Launch a new vscode instance with the `Launch Extension` vscode debug config

## Todo
- fix for-statment type deduction
- add if/elif/else ordering validation
- add detection for function/variable shadowing builtin/api
- add detection for leaked flow statement variable use
- add detection for redeclaration within scope
- add dynamic import statement support
- add list element type deduction