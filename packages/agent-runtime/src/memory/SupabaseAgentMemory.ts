import { createClient } from "@supabase/supabase-js";

export class SupabaseAgentMemory {
  private client;

  constructor() {
    this.client = createClient(
      process.env.https://fxuiljecdjgyffkjzqzl.supabase.co!,
      process.env.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4dWlsamVjZGpneWZma2p6cXpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MjU0OTUsImV4cCI6MjA5NjAwMTQ5NX0.awMYL1hFl-lBF1QIh4KtkYSMmsCnVlwKfmKLwIhb2SM!
    );
  }

  async saveExecution(data: {
    taskId: string;
    agent: string;
    result: any;
  }) {
    const { error } = await this.client.from("agent_runs").insert({
      task_id: data.taskId,
      agent_type: data.agent,
      result: data.result,
      created_at: new Date().toISOString(),
    });

    if (error) {
      throw new Error(`Supabase save failed: ${error.message}`);
    }

    return { success: true };
  }

  async getHistory(taskId: string) {
    const { data, error } = await this.client
      .from("agent_runs")
      .select("*")
      .eq("task_id", taskId);

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }
}
