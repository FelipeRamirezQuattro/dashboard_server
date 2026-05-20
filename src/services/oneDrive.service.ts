import axios, { AxiosInstance, AxiosResponse } from "axios";
import FileBank from "../models/FileBank.model";
import { env } from "../config/env";
import logger from "../utils/logger";

interface GraphDriveItem {
  id: string;
  name: string;
  webUrl?: string;
  size?: number;
  file?: { mimeType?: string };
  folder?: unknown;
  lastModifiedDateTime?: string;
  description?: string;
}

interface OneDriveSyncStatus {
  configured: boolean;
  driveId?: string;
  folderItemId?: string;
  folderWebUrl?: string;
  indexedCount: number;
  lastIndexedAt?: Date;
}

interface GraphChildrenResponse {
  value?: GraphDriveItem[];
  "@odata.nextLink"?: string;
}

class OneDriveService {
  private token?: { value: string; expiresAt: number };

  isConfigured(): boolean {
    return Boolean(
      env.oneDriveClientId &&
        env.oneDriveClientSecret &&
        env.oneDriveTenantId &&
        env.oneDriveDriveId &&
        env.oneDriveFolderItemId,
    );
  }

  async getStatus(): Promise<OneDriveSyncStatus> {
    const [indexedCount, latest] = await Promise.all([
      FileBank.countDocuments({ source: "onedrive" }),
      FileBank.findOne({ source: "onedrive", indexedAt: { $exists: true } })
        .sort({ indexedAt: -1 })
        .select("indexedAt")
        .lean(),
    ]);

    return {
      configured: this.isConfigured(),
      driveId: env.oneDriveDriveId,
      folderItemId: env.oneDriveFolderItemId,
      folderWebUrl: env.oneDriveFolderWebUrl,
      indexedCount,
      lastIndexedAt: latest?.indexedAt,
    };
  }

  async syncFolder(): Promise<{ indexed: number; skipped: number }> {
    if (!this.isConfigured()) {
      throw new Error(
        "OneDrive is not configured. Set ONEDRIVE_DRIVE_ID and ONEDRIVE_FOLDER_ITEM_ID.",
      );
    }

    const client = await this.getClient();
    const indexed = await this.indexChildren(
      client,
      env.oneDriveFolderItemId!,
      env.oneDriveFolderWebUrl,
    );

    return { indexed, skipped: 0 };
  }

  async search(query: string, limit = 5): Promise<void> {
    if (!this.isConfigured() || !env.oneDriveFolderWebUrl) return;

    try {
      const client = await this.getClient();
      const queryString = `${query} path:"${env.oneDriveFolderWebUrl}" isDocument=true`;
      const { data } = await client.post("/search/query", {
        requests: [
          {
            entityTypes: ["driveItem"],
            query: { queryString },
            from: 0,
            size: limit,
          },
        ],
      });

      const hits =
        data?.value?.[0]?.hitsContainers?.flatMap(
          (container: { hits?: Array<{ resource?: GraphDriveItem; summary?: string }> }) =>
            container.hits || [],
        ) || [];

      for (const hit of hits) {
        if (hit.resource) {
          await this.upsertDriveItem(hit.resource, hit.summary || "");
        }
      }
    } catch (error) {
      logger.warn("OneDrive search indexing failed:", error);
    }
  }

  private async getClient(): Promise<AxiosInstance> {
    const token = await this.getAccessToken();
    return axios.create({
      baseURL: "https://graph.microsoft.com/v1.0",
      timeout: 20_000,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt > now + 60_000) {
      return this.token.value;
    }

    const url = `https://login.microsoftonline.com/${env.oneDriveTenantId}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: env.oneDriveClientId!,
      client_secret: env.oneDriveClientSecret!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    });

    const { data } = await axios.post(url, body, {
      timeout: 15_000,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    this.token = {
      value: data.access_token,
      expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
    };

    return this.token.value;
  }

  private async indexChildren(
    client: AxiosInstance,
    folderItemId: string,
    folderWebUrl?: string,
  ): Promise<number> {
    let indexed = 0;
    let nextUrl:
      | string
      | undefined = `/drives/${env.oneDriveDriveId}/items/${folderItemId}/children?$select=id,name,webUrl,size,file,folder,lastModifiedDateTime,description`;

    while (nextUrl) {
      const response: AxiosResponse<GraphChildrenResponse> =
        await client.get<GraphChildrenResponse>(nextUrl);
      const data: GraphChildrenResponse = response.data;
      const items = (data.value || []) as GraphDriveItem[];

      for (const item of items) {
        if (item.folder) {
          indexed += await this.indexChildren(client, item.id, item.webUrl || folderWebUrl);
          continue;
        }

        await this.upsertDriveItem(item);
        indexed += 1;
      }

      nextUrl = data["@odata.nextLink"]
        ? String(data["@odata.nextLink"]).replace(client.defaults.baseURL || "", "")
        : undefined;
    }

    return indexed;
  }

  private async upsertDriveItem(
    item: GraphDriveItem,
    summary = "",
  ): Promise<void> {
    const lastModifiedAt = item.lastModifiedDateTime
      ? new Date(item.lastModifiedDateTime)
      : undefined;
    const description = summary || item.description || "Indexed from OneDrive";
    const searchText = [item.name, description, "onedrive", summary]
      .filter(Boolean)
      .join(" ");

    await FileBank.findOneAndUpdate(
      { source: "onedrive", externalId: item.id },
      {
        $set: {
          originalName: item.name,
          storedName: item.id,
          mimeType: item.file?.mimeType || "application/octet-stream",
          sizeBytes: item.size || 0,
          description,
          tags: ["onedrive"],
          searchText,
          contentText: summary,
          source: "onedrive",
          storageProvider: "onedrive",
          externalId: item.id,
          webUrl: item.webUrl,
          downloadUrl: item.webUrl || "",
          filePath: "",
          uploadedBy: "onedrive-sync",
          indexedAt: new Date(),
          lastModifiedAt,
          syncStatus: "indexed",
          syncError: "",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
}

export const oneDriveService = new OneDriveService();
