#!/bin/bash

# Navigate to the agent directory
cd "$(dirname "$0")/../agent" || exit 1

# Create virtual environment if it doesn't exist
if [ ! -d ".venv" ]; then
  python3 -m venv .venv || python -m venv .venv
fi

# Activate the virtual environment
source .venv/bin/activate

# Install the agent as an editable project
(pip3 install -e . || pip install -e .)
