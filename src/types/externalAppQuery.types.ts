/**
 * External App Query Types
 * Represents different types of queries that require data from external applications
 */
export type ExternalAppQueryType =
  | "chemical_tracker_wells"
  | "chemical_tracker_analytics"
  | "chemical_tracker_clients"
  | "pump_pro_reports"
  | "designer_projects"
  | null;

/**
 * Extended Intent with external app query support
 */
export interface ExtendedIntent {
  patterns: (string | RegExp)[];
  response?: string; // Optional for external queries
  keywords?: string[];
  externalAppQuery?: ExternalAppQueryType; // New: indicates this needs external data
  requiresAuth?: boolean; // New: some queries need user context
}

/**
 * External Query Result
 * Standard format for data returned from external apps
 */
export interface ExternalQueryResult {
  success: boolean;
  data?: any;
  formattedResponse?: string; // Pre-formatted text for chatbot
  error?: {
    code: string;
    message: string;
    userFriendlyMessage: string; // What to show the user
  };
}
