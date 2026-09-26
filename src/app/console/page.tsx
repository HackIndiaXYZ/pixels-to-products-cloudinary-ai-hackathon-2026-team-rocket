import type { Metadata } from 'next';
import { ConsoleRoot } from '@/components/console/ConsoleRoot';

export const metadata: Metadata = {
  title: 'Console',
  description: 'Search, inspect, transform and report on operational media — processed by Cloudinary.',
};

export default function ConsolePage() {
  return <ConsoleRoot />;
}
