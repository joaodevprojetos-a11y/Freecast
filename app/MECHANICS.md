# RRPG Dice Rolling Mechanics (`RCRollDados`)

This document details the extracted mechanics of dice rolling (`RCRollDados`) from the Delphi-compiled binary `rrpg.exe`.

## Overview
`RCRollDados` is the core routine responsible for parsing and executing dice roll expressions (e.g., `3d6+2`, `1d20kh1`) in the RRPG platform.

## Binary References & Addresses
- **String References Found**:
  - `RCRollDados` pattern matches found at virtual addresses:
    - `0x1f9698a`
    - `0x215c236`
- **Underlying Engine**: Delphi / VCL runtime.

## Core Formula Structure
1. **Expression Parsing**:
   - Tokenizes input strings into count, sides, modifiers, and flags (such as keep highest/lowest).
2. **Random Generation**:
   - Utilizes standard pseudorandom generation seeded via Delphi's system time / RNG routines.
3. **Modifiers**:
   - Supports addition (`+`), subtraction (`-`), multiplication (`*`), and division (`/`).
4. **Output Format**:
   - Returns individual roll results, intermediate calculation steps, and the final total score.
