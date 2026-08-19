/**
 * Ollama HTTP 클라이언트. 계획서 §5 Phase 1-7 / 2-7
 *
 * 스트리밍은 stream.ts가 맡고, 여기서는 비스트리밍 엔드포인트와
 * 헬스체크·워밍업을 담당한다.
 */

import type {
  ChatRequest,
  EmbedResponse,
  ModelInfo,
  PsResponse,
  TagsResponse,
} from '@/types/ollama';
import type { AppError } from '@/lib/messaging/protocol';
import {
  OllamaError,
  pullCommand,
  refineConnectionError,
} from './errors';
import { streamChat } from './stream';

async function getJson<T>(endpoint: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${endpoint}${path}`, { cache: 'no-store' });
  } catch (e) {
    throw await refineConnectionError(endpoint, e);
  }
  if (!res.ok) {
    throw new OllamaError('UNKNOWN', `${path} 실패 (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}

export async function getVersion(endpoint: string): Promise<string> {
  const v = await getJson<{ version: string }>(endpoint, '/api/version');
  return v.version;
}

export async function listModels(endpoint: string): Promise<ModelInfo[]> {
  const tags = await getJson<TagsResponse>(endpoint, '/api/tags');
  return tags.models ?? [];
}

export async function listRunning(endpoint: string): Promise<PsResponse['models']> {
  const ps = await getJson<PsResponse>(endpoint, '/api/ps');
  return ps.models ?? [];
}

/** /api/show — 모델의 capabilities(tools·vision·thinking…) 확인용. */
export async function showModel(
  endpoint: string,
  model: string,
): Promise<ModelInfo & { capabilities?: string[] }> {
  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
  } catch (e) {
    throw await refineConnectionError(endpoint, e);
  }
  if (!res.ok) {
    throw new OllamaError(
      'MODEL_MISSING',
      `모델 '${model}' 정보를 가져오지 못했습니다.`,
      pullCommand(model),
    );
  }
  return (await res.json()) as ModelInfo & { capabilities?: string[] };
}

export async function embed(
  endpoint: string,
  model: string,
  input: string | string[],
): Promise<number[][]> {
  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input, keep_alive: '2m' }),
    });
  } catch (e) {
    throw await refineConnectionError(endpoint, e);
  }
  if (!res.ok) throw new OllamaError('UNKNOWN', `임베딩 실패 (HTTP ${res.status})`);
  const json = (await res.json()) as EmbedResponse;
  return json.embeddings ?? [];
}

/* ── 헬스체크 ──────────────────────────────────────────── */

export type HealthState =
  | 'ok'         // 연결됨 + 모델 있음 + 상주 중
  | 'cold'       // 연결됨 + 모델 있음, 그러나 메모리에 없음 (첫 응답 ~21초)
  | 'model-missing'
  | 'cors-blocked'
  | 'down'
  | 'checking';

export interface HealthReport {
  state: HealthState;
  version?: string;
  models: ModelInfo[];
  /** 대상 모델이 메모리에 상주 중인가 */
  resident: boolean;
  /** ★ 상주 모델이 GPU에 올라갔는가. false면 CPU 추론 — 성능 목표가 달라진다. */
  onGpu: boolean;
  error?: AppError;
}

export async function checkHealth(
  endpoint: string,
  model: string,
): Promise<HealthReport> {
  const empty: Omit<HealthReport, 'state'> = {
    models: [],
    resident: false,
    onGpu: false,
  };

  let version: string;
  let models: ModelInfo[];
  try {
    version = await getVersion(endpoint);
    models = await listModels(endpoint);
  } catch (e) {
    const err = e instanceof OllamaError ? e : new OllamaError('UNKNOWN', String(e));
    return {
      ...empty,
      state: err.code === 'CORS_BLOCKED' ? 'cors-blocked' : 'down',
      error: err.toAppError(),
    };
  }

  const has = models.some((m) => m.name === model || m.model === model);
  if (!has) {
    return {
      ...empty,
      state: 'model-missing',
      version,
      models,
      error: {
        code: 'MODEL_MISSING',
        message: `모델 '${model}'이 설치되어 있지 않습니다.`,
        hint: pullCommand(model),
      },
    };
  }

  let resident = false;
  let onGpu = false;
  try {
    const running = await listRunning(endpoint);
    const hit = running.find((m) => m.name === model || m.model === model);
    resident = Boolean(hit);
    // size_vram > 0 이면 일부라도 GPU에 올라간 것.
    onGpu = (hit?.size_vram ?? 0) > 0;
  } catch {
    /* /api/ps 실패는 치명적이지 않다 — 상주 여부만 모를 뿐이다 */
  }

  return {
    state: resident ? 'ok' : 'cold',
    version,
    models,
    resident,
    onGpu,
  };
}

/* ── 워밍업 ────────────────────────────────────────────── */

/**
 * 모델을 메모리에 올려둔다. 콜드 21.5초를 사용자가 체감하지 않게 만드는 유일한 수단.
 *
 * ★ numCtx는 이후 실제 대화와 **반드시 동일**해야 한다. 값이 다르면 Ollama가
 *   모델을 리로드하므로 워밍업이 통째로 무의미해진다. 계획서 §1 변경 7번.
 */
export async function warmup(
  endpoint: string,
  model: string,
  numCtx: number,
  keepAlive: string,
  signal?: AbortSignal,
): Promise<void> {
  const req: ChatRequest = {
    model,
    messages: [{ role: 'user', content: 'hi' }],
    stream: true,
    think: false,
    keep_alive: keepAlive,
    options: { num_ctx: numCtx, num_predict: 1, temperature: 0 },
  };
  // 응답 내용은 버린다. 목적은 오직 모델 상주.
  await streamChat(endpoint, req, {}, signal);
}
