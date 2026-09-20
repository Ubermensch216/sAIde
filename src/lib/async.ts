/** Ends the caller's wait even when the underlying browser API ignores cancellation. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    // Attach both handlers even for an already-aborted signal: no unhandled rejection.
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
}

export function deadlineSignal(ms: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(outer?.reason);
  if (outer?.aborted) abort();
  else outer?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), ms);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); outer?.removeEventListener('abort', abort); },
  };
}

/**
 * 무응답 감시. 진행 중인(바이트가 들어오는) 생성은 아무리 길어도 끊지 않는다.
 *
 * ★ `armed: false`로 만들면 첫 touch()가 오기 전까지 시계가 돌지 않는다.
 *   CPU 추론의 프리필은 첫 글자가 나올 때까지 **정상적으로** 수십 초에서 수 분을 침묵한다.
 *   그 침묵을 실패로 세면, 긴 본문을 붙인 정상 요청이 늘 타임아웃으로 끝난다.
 *   실제로 잡아야 하는 것은 "흐르다 멈춘" 연결이다.
 */
export function idleSignal(ms: number, outer?: AbortSignal, armed = true) {
  const controller = new AbortController();
  const abort = () => controller.abort(outer?.reason);
  let timer: ReturnType<typeof setTimeout>;
  const touch = () => {
    clearTimeout(timer);
    if (!controller.signal.aborted) timer = setTimeout(() => controller.abort(new DOMException('Response timed out', 'TimeoutError')), ms);
  };
  if (outer?.aborted) abort();
  else outer?.addEventListener('abort', abort, { once: true });
  if (armed) touch();
  return { signal: controller.signal, touch, dispose() { clearTimeout(timer); outer?.removeEventListener('abort', abort); } };
}
