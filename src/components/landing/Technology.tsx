import { RevealText } from '@/components/motion/RevealText';
import { CapabilityExplorer } from './tech/CapabilityExplorer';
import { TelemetryFlow } from './tech/TelemetryFlow';

/**
 * Technology — Cloudinary as the media infrastructure, presented as
 * engineering telemetry: one real delivery URL measured live across the
 * pipeline stages, then an explorer of the transformations VisualOps uses.
 */
export function Technology() {
  return (
    <section id="technology" aria-label="Technology" className="relative scroll-mt-[60px] border-t border-line bg-canvas">
      <div className="mx-auto max-w-[1320px] px-4 pb-24 pt-24 sm:px-6 lg:pb-36 lg:pt-36">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-6">
          <div className="lg:col-span-8">
            <p className="label">Technology · Media infrastructure</p>
            <RevealText
              as="h2"
              lines={['Cloudinary is the', 'media infrastructure.']}
              className="type-display mt-6 text-[clamp(42px,6.4vw,96px)] text-ink"
            />
          </div>
          <div className="lg:col-span-4 lg:self-end">
            <p className="max-w-[42ch] text-[15.5px] leading-relaxed text-ink-2">
              VisualOps runs no media servers. Captures upload straight from the browser to Cloudinary; understanding, transformation,
              optimisation and delivery are URL components that Cloudinary executes on request.
            </p>
            <p className="mt-4 max-w-[42ch] text-[13px] leading-relaxed text-ink-3">
              Delivery figures here — bytes, formats, cache state, timings — are read from Cloudinary’s own response headers, by your browser.
            </p>
          </div>
        </div>

        <TelemetryFlow />

        <div className="mt-24 lg:mt-36">
          <div className="grid gap-6 lg:grid-cols-12 lg:gap-6">
            <div className="lg:col-span-4">
              <p className="label">Capabilities</p>
            </div>
            <div className="lg:col-span-8">
              <RevealText
                as="h3"
                lines={['Eight transformations.', 'One URL each.']}
                className="type-display text-[clamp(34px,4.4vw,64px)] text-ink"
              />
              <p className="mt-6 max-w-[56ch] text-[15px] leading-relaxed text-ink-2">
                Select one. Cloudinary renders it on the sample dataset at the moment you ask — open the URL and anyone gets the same result.
              </p>
            </div>
          </div>
          <div className="mt-12 lg:mt-16">
            <CapabilityExplorer />
          </div>
        </div>
      </div>
    </section>
  );
}
