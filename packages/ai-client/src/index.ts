import { ChatCompletionMessageParam } from "openai/resources/chat";

export interface NVIDIANimClientOptions {
  apiKey: string;
  baseURL?: string;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface EmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

export class NVIDIANimClient {
  private apiKey: string;
  private baseURL: string;

  constructor(options: NVIDIANimClientOptions) {
    this.apiKey = options.apiKey;
    this.baseURL = options.baseURL || "https://integrate.api.nvidia.com/v1";
  }

  async chatCompletion(model: string, messages: ChatCompletionMessageParam[]) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
      }),
    });
    return await response.json() as ChatCompletionResponse;
  }

  async embedding(input: string) {
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "nvidia/embed-qa-4",
        input,
      }),
    });
    return await response.json() as EmbeddingResponse;
  }
}