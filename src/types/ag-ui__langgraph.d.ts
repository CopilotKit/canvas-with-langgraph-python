declare module "@ag-ui/langgraph" {
  import type { AbstractAgent } from "@ag-ui/client";

  export interface LangGraphAgentConfig {
    deploymentUrl: string;
    graphId: string;
    langsmithApiKey?: string;
    agentName?: string;
  }

  export class LangGraphAgent extends AbstractAgent {
    constructor(config: LangGraphAgentConfig);
  }
}

 