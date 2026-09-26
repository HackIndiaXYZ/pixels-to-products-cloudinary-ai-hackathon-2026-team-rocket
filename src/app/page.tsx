import { Hero } from '@/components/landing/Hero';
import { PipelineStory } from '@/components/landing/PipelineStory';
import { CloudinaryProof, Integrity, LandingFooter, LandingNav, RunIt } from '@/components/landing/LandingSections';

export default function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <PipelineStory />
        <CloudinaryProof />
        <Integrity />
        <RunIt />
      </main>
      <LandingFooter />
    </>
  );
}
