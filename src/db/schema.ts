import { pgTable, serial, text, timestamp, jsonb, bigint } from "drizzle-orm/pg-core";

export const jobs = pgTable("jobs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("pending"),
  statusMessage: text("status_message").default("Ожидание загрузки..."),
  video1Name: text("video1_name"),
  video2Name: text("video2_name"),
  trimPoint: text("trim_point"),
  mergedVideoUrl: text("merged_video_url"),
  screenshots: jsonb("screenshots").$type<string[]>().default([]),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  chatId: bigint("chat_id", { mode: "number" }).notNull(),
  username: text("username"),
  jobId: text("job_id"),
  status: text("status").notNull().default("waiting"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
