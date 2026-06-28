import SmoothScroll from './components/motion/SmoothScroll';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import TrustMarquee from './components/TrustMarquee';
import SeeItBuild from './components/SeeItBuild';
import Loop from './components/Loop';
import Capabilities from './components/Capabilities';
import Domains from './components/Domains';
import Proof from './components/Proof';
import CTA from './components/CTA';

export default function App() {
  return (
    <div className="bg-ink-950">
      <SmoothScroll />
      <Navbar />
      <main>
        <Hero />
        <TrustMarquee />
        <SeeItBuild />
        <Loop />
        <Capabilities />
        <Domains />
        <Proof />
        <CTA />
      </main>
    </div>
  );
}
