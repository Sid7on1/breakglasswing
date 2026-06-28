import Navbar from './components/Navbar';
import Hero from './components/Hero';
import HowItWorks from './components/HowItWorks';
import Capabilities from './components/Capabilities';
import Domains from './components/Domains';
import Proof from './components/Proof';
import CTA from './components/CTA';

export default function App() {
  return (
    <div className="bg-ink-950">
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <Capabilities />
        <Domains />
        <Proof />
        <CTA />
      </main>
    </div>
  );
}
