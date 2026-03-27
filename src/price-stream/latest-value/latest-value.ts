export function latestValue<T>(options?: SignalOptions): Signal<T> {
    let value: T | undefined;
    let notify: (() => void) | null = null;

    return {
        set(newValue) {
            value = newValue;
            notify?.();
        },
        async *[Symbol.asyncIterator]() {
            while (!options?.signal?.aborted) {
                if (value === undefined) {
                    const { promise, resolve } = Promise.withResolvers<void>();
                    notify = resolve;
                    const resolveOnAbort = () => resolve();
                    options?.signal?.addEventListener("abort", resolveOnAbort, { once: true });
                    await promise;
                    options?.signal?.removeEventListener("abort", resolveOnAbort);
                    if (value === undefined) continue;
                }
                const v = value!;
                value = undefined;
                yield v;
            }
        },
    };
}

export interface Signal<T> {
    set(value: T): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

export interface SignalOptions {
    signal?: AbortSignal;
}
