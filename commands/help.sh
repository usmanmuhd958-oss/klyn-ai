#!/bin/bash

cat << 'TXT'
Klyn AI OS CLI

USAGE:
  klyn goal "description"
  klyn generate <type> <name>
  klyn plugin install <name>
  klyn run
  klyn deploy
  klyn doctor
  klyn help

EXAMPLES:
  klyn goal "Build a chat app"
  klyn generate api users
  klyn plugin install react
TXT
