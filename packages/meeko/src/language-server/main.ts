#!/usr/bin/env node
import { runLanguageServer } from './server'

runLanguageServer(process.argv.slice(2))
