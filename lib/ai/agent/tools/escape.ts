// lib/ai/agent/tools/escape.ts
import { tool } from "ai";
import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type AdminClient = SupabaseClient<Database>;

export interface EscapeCtx {
  supabase: AdminClient;
  userId: string;
  chatId: number;
}

const FORBIDDEN =
  /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|EXECUTE|CALL|MERGE|REPLACE|VACUUM|REINDEX)\b/i;
const MULTI_STMT = /;\s*\S/;
const USER_ID_FILTER = /user_id\s*=\s*\$1/i;

export function validateSelectOnly(sql: string): void {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.length === 0) {
    throw new Error("run_readonly_sql: sql vacío");
  }
  if (!/^(WITH\s|SELECT\s)/i.test(trimmed)) {
    throw new Error("run_readonly_sql: solo SELECT o WITH ... SELECT");
  }
  if (FORBIDDEN.test(trimmed)) {
    throw new Error("run_readonly_sql: keyword DDL/DML detectado");
  }
  if (MULTI_STMT.test(trimmed)) {
    throw new Error("run_readonly_sql: múltiples statements no permitidos");
  }
  if (!USER_ID_FILTER.test(trimmed)) {
    throw new Error("run_readonly_sql: el SQL debe filtrar por user_id = $1");
  }
}

export function withLimit(sql: string, max = 100): string {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  return /\bLIMIT\s+\d+/i.test(trimmed) ? trimmed : `${trimmed} LIMIT ${max}`;
}

const Input = z.object({
  sql: z
    .string()
    .min(1)
    .describe(
      "SELECT (o WITH...SELECT). DEBE incluir un filtro `user_id = $1` (el server vincula $1 al user_id de forma segura). LIMIT 100 se agrega automáticamente si no está.",
    ),
  why: z
    .string()
    .min(5)
    .describe("Por qué ninguna otra tool encaja. Se loguea para auditoría."),
});

function hashSql(sql: string): string {
  // Tiny non-crypto hash (FNV-1a) — only used as a log identifier.
  let h = 2166136261;
  for (let i = 0; i < sql.length; i += 1) {
    h ^= sql.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(16);
}

export function runReadonlySqlTool(ctx: EscapeCtx) {
  return tool({
    description:
      "Último recurso. Ejecuta una query SELECT contra los datos del usuario para responder analytics que ninguna otra tool cubre. El SQL DEBE filtrar por `user_id = $1` (el server vincula $1 server-side, nunca pongas el id literal). Solo se permite SELECT/WITH; nada de escritura.",
    inputSchema: Input,
    execute: async (input) => {
      validateSelectOnly(input.sql);
      const limited = withLimit(input.sql);
      console.info("[agent/escape]", {
        user_id: ctx.userId,
        chat_id: ctx.chatId,
        sql_hash: hashSql(limited),
        why: input.why,
      });
      const { data, error } = await ctx.supabase.rpc("agent_readonly_query", {
        p_sql: limited,
        p_user_id: ctx.userId,
      });
      if (error) throw new Error(`run_readonly_sql: ${error.message}`);
      return data;
    },
  });
}
