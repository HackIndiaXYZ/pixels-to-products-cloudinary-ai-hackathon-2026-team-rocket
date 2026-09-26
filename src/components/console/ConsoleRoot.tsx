'use client';

import { useSyncExternalStore } from 'react';
import { ConsoleProvider } from './store';
import { ConsoleShell } from './ConsoleShell';

const subscribe = () => () => {};

/**
 * The console reads the viewer's clock, the URL hash and localStorage, so it
 * renders on the client only. The server sends a lightweight frame.
 */
export function ConsoleRoot() {
  const isClient = useSyncExternalStore(subscribe, () => true, () => false);
  if (!isClient) return <ConsoleSkeleton />;
  return (
    <ConsoleProvider>
      <ConsoleShell />
    </ConsoleProvider>
  );
}

function ConsoleSkeleton() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="h-[52px] border-b border-line" />
      <div className="flex">
        <div className="hidden h-[calc(100vh-52px)] w-[220px] border-r border-line lg:block" />
        <div className="flex-1 p-6">
          <div className="h-6 w-48 animate-pulse rounded bg-raised" />
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-[12px] bg-surface" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
