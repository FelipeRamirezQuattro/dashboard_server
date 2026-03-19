import {
  ExternalAppClientFactory,
  ExternalAppResponse,
} from "./externalApp.client";

/**
 * Chemical Tracker specific data types
 */
export interface ChemicalTrackerWell {
  id: string;
  name: string;
  clientName: string;
  status: string;
  location?: string;
}

export interface ChemicalTrackerClient {
  id: string;
  name: string;
  wellCount?: number;
}

export interface ChemicalTrackerAnalytics {
  totalWells: number;
  activeWells: number;
  totalClients: number;
  recentAlerts?: number;
}

/**
 * ChemicalTrackerService
 * Handles all interactions with Chemical Tracker external application
 */
class ChemicalTrackerService {
  private readonly baseURL = "https://chemical-tracker.osi-apps.com";

  /**
   * Get list of all wells
   */
  async getWells(params?: {
    limit?: number;
    search?: string;
    clientId?: string;
  }): Promise<
    ExternalAppResponse<{ wells: ChemicalTrackerWell[]; total: number }>
  > {
    const client = ExternalAppClientFactory.getClient(
      "ChemicalTracker",
      this.baseURL,
    );

    return await client.get("/api/chatbot/wells", { params });
  }

  /**
   * Get well details by ID
   */
  async getWellById(wellId: string): Promise<ExternalAppResponse<any>> {
    const client = ExternalAppClientFactory.getClient(
      "ChemicalTracker",
      this.baseURL,
    );

    return await client.get(`/api/chatbot/wells/${wellId}`);
  }

  /**
   * Get analytics summary
   */
  async getAnalytics(): Promise<ExternalAppResponse<ChemicalTrackerAnalytics>> {
    const client = ExternalAppClientFactory.getClient(
      "ChemicalTracker",
      this.baseURL,
    );

    return await client.get("/api/chatbot/analytics/summary");
  }

  /**
   * Get list of clients
   */
  async getClients(): Promise<
    ExternalAppResponse<{ clients: ChemicalTrackerClient[]; total: number }>
  > {
    const client = ExternalAppClientFactory.getClient(
      "ChemicalTracker",
      this.baseURL,
    );

    return await client.get("/api/chatbot/clients");
  }

  /**
   * Format well data for chatbot response
   */
  formatWellsResponse(wells: ChemicalTrackerWell[], total: number): string {
    if (wells.length === 0) {
      return "No wells found in Chemical Tracker.";
    }

    const wellList = wells
      .slice(0, 10) // Show max 10
      .map((well) => `• ${well.name} (${well.clientName}) - ${well.status}`)
      .join("\n");

    const suffix = total > 10 ? `\n\n...and ${total - 10} more wells.` : "";

    return `Found ${total} well${total !== 1 ? "s" : ""} in Chemical Tracker:\n\n${wellList}${suffix}`;
  }

  /**
   * Format analytics for chatbot response
   */
  formatAnalyticsResponse(analytics: ChemicalTrackerAnalytics): string {
    return `Chemical Tracker Summary:\n• Total Wells: ${analytics.totalWells}\n• Active Wells: ${analytics.activeWells}\n• Total Clients: ${analytics.totalClients}${analytics.recentAlerts ? `\n• Recent Alerts: ${analytics.recentAlerts}` : ""}`;
  }

  /**
   * Format clients for chatbot response
   */
  formatClientsResponse(
    clients: ChemicalTrackerClient[],
    total: number,
  ): string {
    if (clients.length === 0) {
      return "No clients found in Chemical Tracker.";
    }

    const clientList = clients
      .slice(0, 10)
      .map(
        (client) =>
          `• ${client.name}${client.wellCount ? ` (${client.wellCount} wells)` : ""}`,
      )
      .join("\n");

    const suffix = total > 10 ? `\n\n...and ${total - 10} more clients.` : "";

    return `Found ${total} client${total !== 1 ? "s" : ""} in Chemical Tracker:\n\n${clientList}${suffix}`;
  }
}

export const chemicalTrackerService = new ChemicalTrackerService();
