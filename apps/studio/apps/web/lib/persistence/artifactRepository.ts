import { supabase } from "@/lib/supabase/client";

export interface ArtifactRecord {
  id?: string;
  projectId: string;
  filename: string;
  language: string;
  content: string;
  artifactType?: string;
  agentSource?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface ArtifactDatabaseRow {
  id: string;
  project_id: string;
  filename: string;
  language: string;
  content: string;
  artifact_type: string;
  agent_source: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function mapArtifactRow(row: ArtifactDatabaseRow): ArtifactRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    language: row.language,
    content: row.content,
    artifactType: row.artifact_type,
    agentSource: row.agent_source ?? undefined,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ArtifactRepository {
  /**
   * Creates a new code artifact.
   */
  async create(artifact: ArtifactRecord): Promise<ArtifactRecord> {
    const { data, error } = await supabase
      .from("artifacts")
      .insert({
        project_id: artifact.projectId,
        filename: artifact.filename,
        language: artifact.language,
        content: artifact.content,
        artifact_type: artifact.artifactType ?? "code",
        agent_source: artifact.agentSource ?? null,
        version: artifact.version ?? 1,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    return mapArtifactRow(data);
  }

  /**
   * Updates an existing artifact.
   */
  async update(id: string, update: Partial<ArtifactRecord>): Promise<ArtifactRecord> {
    const { data, error } = await supabase
      .from("artifacts")
      .update({
        content: update.content,
        filename: update.filename,
        language: update.language,
        version: update.version,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return mapArtifactRow(data);
  }

  /**
   * Gets all artifacts belonging to a project.
   */
  async findByProject(projectId: string): Promise<ArtifactRecord[]> {
    const { data, error } = await supabase
      .from("artifacts")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (error) {
      throw error;
    }

    return data.map(mapArtifactRow);
  }

  /**
   * Removes an artifact permanently.
   */
  async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from("artifacts")
      .delete()
      .eq("id", id);

    if (error) {
      throw error;
    }
  }
}

export const artifactRepository = new ArtifactRepository();
