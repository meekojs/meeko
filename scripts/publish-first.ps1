#requires -Version 7.0
[CmdletBinding()]
param(
  [switch]$Execute,
  [switch]$Resume,
  [string]$Registry = 'https://registry.npmjs.org/'
)
$ErrorActionPreference = 'Stop'
# First publication is interactive and always a dry run unless the maintainer explicitly opts in.
# It only publishes packages new to npm; existing ones keep their provenance through publish.yml.
& "$PSScriptRoot/publish-packages.ps1" -Execute:$Execute -Resume:$Resume -Registry $Registry
