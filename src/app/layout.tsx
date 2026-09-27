import type { Metadata, Viewport } from 'next';
import { Archivo, Geist, Geist_Mono } from 'next/font/google';
import { MotionProvider } from '@/components/providers/MotionProvider';
import { ContextCursor } from '@/components/site/ContextCursor';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/** Variable display face: width (62–125) and weight (100–900) drive the kinetic type. */
const archivo = Archivo({
  variable: '--font-archivo',
  subsets: ['latin'],
  axes: ['wdth'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'VisualOps — Turn visual data into operational intelligence',
    template: '%s · VisualOps',
  },
  description:
    'VisualOps turns field photos, drone footage and CCTV into searchable, structured, decision-ready operational evidence — processed end to end by Cloudinary.',
  applicationName: 'VisualOps',
  keywords: ['Cloudinary', 'visual AI', 'inspections', 'field operations', 'media pipeline', 'hackathon'],
  openGraph: {
    title: 'VisualOps',
    description: 'Turn visual data into operational intelligence.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'VisualOps',
    description: 'Turn visual data into operational intelligence.',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a1120',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        <MotionProvider>
          {children}
          <ContextCursor />
        </MotionProvider>
      </body>
    </html>
  );
}
