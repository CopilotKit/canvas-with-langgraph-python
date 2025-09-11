# CopilotKit <> LangGraph Starter

This is a starter template for building AI agents using [LangGraph](https://www.langchain.com/langgraph) and [CopilotKit](https://copilotkit.ai). It provides a modern Next.js application with an integrated LangGraph agent to be built on top of.

## Prerequisites

- Node.js 18+ 
- Python 3.12+
- Any of the following package managers:
  - [pnpm](https://pnpm.io/installation) (recommended)
  - npm
  - [yarn](https://classic.yarnpkg.com/lang/en/docs/install/#mac-stable)
  - [bun](https://bun.sh/)
- OpenAI API Key (for the LangGraph agent)

> **Note:** This repository ignores lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lockb) to avoid conflicts between different package managers. Each developer should generate their own lock file using their preferred package manager. After that, make sure to delete it from the .gitignore.

## Getting Started

1. Install dependencies using your preferred package manager:
```bash
# Using pnpm (recommended)
pnpm install

# Using npm
npm install

# Using yarn
yarn install

# Using bun
bun install
```

> **Note:** Installing the package dependencies will also install the agent's python dependencies via the `install:agent` script.


2. Set up your OpenAI API key:
```bash
echo 'OPENAI_API_KEY=your-openai-api-key-here' > agent/.env
```

3. Start the development server:
```bash
# Using pnpm
pnpm dev

# Using npm
npm run dev

# Using yarn
yarn dev

# Using bun
bun run dev
```

This will start both the UI and agent servers concurrently.
## Deploying on Vercel (Web + Python Agent)

This project is configured to deploy both the Next.js web app and the Python agent on Vercel using the Python Runtime [docs](https://vercel.com/docs/functions/runtimes/python.md).

Key points:

- The Python agent is exposed via a Vercel Function at `api/langgraph.py` implementing:
  - `POST /api/langgraph/graphs/sample_agent/invoke`
  - `POST /api/langgraph/graphs/sample_agent/stream`
- The frontend uses `@ag-ui/langgraph` with `deploymentUrl` auto-pointing to `/api/langgraph` when `VERCEL=1`.
- Python dependencies are in root `requirements.txt` (mirrored in `Pipfile`).
- Python version is pinned to 3.12 via `Pipfile` per Vercel guidance; also set Node 20.x or 22.x in Vercel Project Settings.
- Node.js engines are set to `^20 || ^22` in `package.json` as recommended when using Python 3.12.

### Environment Variables

Set the following in your Vercel Project Settings:

- `OPENAI_API_KEY` (Required)
  (LangSmith not required.)

No need to set `LANGGRAPH_DEPLOYMENT_URL` on Vercel — it defaults to the internal function.

### Local Development vs Vercel

- Local development runs the LangGraph CLI on `http://localhost:8123`.
- On Vercel, the agent endpoints are served by the Python function under `/api/langgraph`.

### Notes

- We skip Python venv bootstrap on Vercel during `postinstall` to avoid nested environments.
- The Python function returns Server-Sent Events for `/stream` to support live updates.

## Available Scripts
The following scripts can also be run using your preferred package manager:
- `dev` - Starts both UI and agent servers in development mode
- `dev:debug` - Starts development servers with debug logging enabled
- `dev:ui` - Starts only the Next.js UI server
- `dev:agent` - Starts only the LangGraph agent server
- `build` - Builds the Next.js application for production
- `start` - Starts the production server
- `lint` - Runs ESLint for code linting
- `install:agent` - Installs Python dependencies for the agent

## Documentation

The main UI component is in `src/app/page.tsx`. You can:
- Modify the theme colors and styling
- Add new frontend actions
- Customize the CopilotKit sidebar appearance

## 📚 Documentation

- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) - Learn more about LangGraph and its features
- [CopilotKit Documentation](https://docs.copilotkit.ai) - Explore CopilotKit's capabilities
- [Next.js Documentation](https://nextjs.org/docs) - Learn about Next.js features and API
- [YFinance Documentation](https://pypi.org/project/yfinance/) - Financial data tools

## Contributing

Feel free to submit issues and enhancement requests! This starter is designed to be easily extensible.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Troubleshooting

### Agent Connection Issues
If you see "I'm having trouble connecting to my tools", make sure:
1. The LangGraph agent is running on port 8000
2. Your OpenAI API key is set correctly
3. Both servers started successfully

### Python Dependencies
If you encounter Python import errors:
```bash
npm install:agent
```

### Dependency Conflicts
If you see dependency conflict errors (e.g., with packages like `guardrails-ai`), the agent uses an isolated virtual environment that should resolve most conflicts automatically.

If issues persist, delete and recreate the virtual environment, then reinstall the requirements.txt:
```bash
cd agent
rm -rf .venv
python -m venv .venv --clear
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```
