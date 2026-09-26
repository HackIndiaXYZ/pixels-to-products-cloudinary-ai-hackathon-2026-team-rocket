import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { MotionProvider } from '@/components/providers/MotionProvider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'VisualOps — Turn visual data into operational intelligence',
    template: '%s · VisualOps',
  },
  description:
    'VisualOps turns field photos, drone footage and CCTV into searchable, structured, actionable records — processed end to end by Cloudinary.',
  applicationName: 'VisualOps',
  keywords: ['Cloudinary', 'visual AI', 'inspections', 'field operations', 'media pipeline', 'hackathon'],
  openGraph: {
    title: 'VisualOps',
    description: 'Turn visual data into operational intelligence.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0b0d',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
