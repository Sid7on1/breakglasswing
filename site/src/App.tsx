import SmoothScroll from './components/motion/SmoothScroll';
import Navbar from './components/Navbar';
import SpaceJourney from './components/space/SpaceJourney';
import { MissionSection, AtlasSection, CrewSection, LaunchSection } from './components/space/Sections';

// The observatory: ONE fixed 3D world (SpaceJourney) behind everything; four full-height DOM
// sections scroll over it, and the page's scroll progress flies the camera between the four
// scenes (planet → constellation → station → nebula). See space/SpaceJourney.tsx for the rig.
export default function App() {
  return (
    <div className="bg-ink-950">
      <SmoothScroll />
      <SpaceJourney />
      <div className="relative z-10">
        <Navbar />
        <main>
          <MissionSection />
          <AtlasSection />
          <CrewSection />
          <LaunchSection />
        </main>
      </div>
    </div>
  );
}
