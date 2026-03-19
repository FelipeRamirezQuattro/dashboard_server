import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import logger from "../utils/logger";

/**
 * Base configuration for external app API calls
 */
interface ExternalAppConfig {
  baseURL: string;
  timeout: number;
  apiKey?: string; // If using API key auth
}

/**
 * Standard response format expected from external apps
 */
interface ExternalAppResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * ExternalAppClient
 * Generic HTTP client for communicating with external OSI applications
 */
class ExternalAppClient {
  private client: AxiosInstance;
  private appName: string;

  constructor(config: ExternalAppConfig, appName: string) {
    this.appName = appName;
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout,
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey && { "X-API-Key": config.apiKey }),
      },
    });

    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.info(
          `[${this.appName}] API Request: ${config.method?.toUpperCase()} ${config.url}`,
        );
        return config;
      },
      (error) => {
        logger.error(`[${this.appName}] API Request Error:`, error);
        return Promise.reject(error);
      },
    );

    // Response interceptor for logging and error handling
    this.client.interceptors.response.use(
      (response) => {
        logger.info(`[${this.appName}] API Response: ${response.status}`);
        return response;
      },
      (error) => {
        if (error.response) {
          logger.error(
            `[${this.appName}] API Error ${error.response.status}:`,
            error.response.data,
          );
        } else if (error.request) {
          logger.error(`[${this.appName}] API No Response:`, error.message);
        } else {
          logger.error(`[${this.appName}] API Setup Error:`, error.message);
        }
        return Promise.reject(error);
      },
    );
  }

  /**
   * GET request to external app
   */
  async get<T = any>(
    endpoint: string,
    config?: AxiosRequestConfig,
  ): Promise<ExternalAppResponse<T>> {
    try {
      const response = await this.client.get<ExternalAppResponse<T>>(
        endpoint,
        config,
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * POST request to external app
   */
  async post<T = any>(
    endpoint: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<ExternalAppResponse<T>> {
    try {
      const response = await this.client.post<ExternalAppResponse<T>>(
        endpoint,
        data,
        config,
      );
      return response.data;
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Add user authentication token to request
   */
  withUserAuth(token: string): this {
    this.client.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    return this;
  }

  /**
   * Add user context for service account calls
   */
  withUserContext(userId: string, userEmail: string): this {
    this.client.defaults.headers.common["X-User-ID"] = userId;
    this.client.defaults.headers.common["X-User-Email"] = userEmail;
    return this;
  }

  /**
   * Standardized error handling
   */
  private handleError(error: any): ExternalAppResponse {
    if (axios.isAxiosError(error) && error.response) {
      // External app returned an error response
      const { data } = error.response;
      if (data && typeof data === "object" && "error" in data) {
        return data as ExternalAppResponse;
      }
      return {
        success: false,
        error: {
          code: "EXTERNAL_APP_ERROR",
          message: data.message || error.response.statusText || "Unknown error",
        },
      };
    }

    // Network error or timeout
    return {
      success: false,
      error: {
        code: "NETWORK_ERROR",
        message: "Failed to connect to external application",
      },
    };
  }
}

/**
 * Factory for creating external app clients
 */
export class ExternalAppClientFactory {
  private static clients: Map<string, ExternalAppClient> = new Map();

  /**
   * Get or create a client for a specific external app
   */
  static getClient(appName: string, baseURL: string): ExternalAppClient {
    const key = `${appName}-${baseURL}`;
    if (!this.clients.has(key)) {
      const config: ExternalAppConfig = {
        baseURL,
        timeout: 15000, // 15 seconds
        // Add API key from env if needed
        // apiKey: env[`${appName}_API_KEY`]
      };
      this.clients.set(key, new ExternalAppClient(config, appName));
    }
    return this.clients.get(key)!;
  }

  /**
   * Clear all cached clients (useful for testing)
   */
  static clearCache(): void {
    this.clients.clear();
  }
}

export { ExternalAppClient, ExternalAppResponse };
