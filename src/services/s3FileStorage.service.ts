import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { env } from "../config/env";

class S3FileStorageService {
  private client?: S3Client;

  isConfigured(): boolean {
    return Boolean(env.awsS3Bucket && env.awsRegion);
  }

  private getClient(): S3Client {
    if (!this.isConfigured()) {
      throw new Error("AWS S3 File Bank storage is not configured");
    }

    if (!this.client) {
      this.client = new S3Client({
        region: env.awsRegion,
        endpoint: env.awsS3Endpoint,
        credentials:
          env.awsAccessKeyId && env.awsSecretAccessKey
            ? {
                accessKeyId: env.awsAccessKeyId,
                secretAccessKey: env.awsSecretAccessKey,
              }
            : undefined,
      });
    }

    return this.client;
  }

  async uploadObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.getClient().send(
      new PutObjectCommand({
        Bucket: env.awsS3Bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async getObjectStream(key: string): Promise<Readable> {
    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: env.awsS3Bucket,
        Key: key,
      }),
    );

    if (!response.Body || !(response.Body instanceof Readable)) {
      throw new Error("S3 object response did not include a readable stream");
    }

    return response.Body;
  }

  async deleteObject(key: string): Promise<void> {
    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: env.awsS3Bucket,
        Key: key,
      }),
    );
  }

  toUri(key: string): string {
    return `s3://${env.awsS3Bucket}/${key}`;
  }
}

export const s3FileStorageService = new S3FileStorageService();
