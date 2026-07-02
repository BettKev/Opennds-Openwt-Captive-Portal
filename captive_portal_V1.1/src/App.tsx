import React, { useState, useEffect } from 'react';

// --- TYPES & INTERFACES ---
interface Package {
  id: string;
  name: string;
  amount: number;
  download_rate: number; 
  duration_hours: number;
}

const DEMO_PACKAGES: Package[] = [
  { id: 'pkg1', name: '1 Hour Eco', amount: 10, download_rate: 3000, duration_hours: 1 },
  { id: 'pkg2', name: '3 Hours Blast', amount: 20, download_rate: 5000, duration_hours: 3 },
  { id: 'pkg3', name: 'Daily Unlimited', amount: 50, download_rate: 8000, duration_hours: 24 },
  { id: 'pkg4', name: 'Weekly Premium', amount: 250, download_rate: 10000, duration_hours: 168 },
];

const DEMO_ADS = [
  { title: "Fast Printing", desc: "Color prints available now." },
  { title: "Cyber Services", desc: "KRA & e-Citizen services." }
];

type AppStep = 'LOGIN' | 'WAITING' | 'CONNECTED';

const App: React.FC = () => {
  // --- STATE ---
  const [step, setStep] = useState<AppStep>('LOGIN');
  const [packages] = useState<Package[]>(DEMO_PACKAGES);
  const [selectedPkgId, setSelectedPkgId] = useState<string>(DEMO_PACKAGES[0]?.id || '');
  const [phone, setPhone] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [adIndex, setAdIndex] = useState<number>(0);

  // --- ROUTER ROUTING VARIABLES (With Demo Fallbacks) ---
  const [macAddress, setMacAddress] = useState<string>('00:11:22:33:44:55'); 
  const [routerToken, setRouterToken] = useState<string>('demo_token_123');
  const [gatewayHash, setGatewayHash] = useState<string>('demo_bhscyber');
  const [clientIp, setClientIp] = useState<string>('192.168.88.25');
  const [isLiveRouter, setIsLiveRouter] = useState<boolean>(false);

  // --- PARSE FAS VARIABLES FROM ROUTER URL ---
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const fasBlob = searchParams.get('fas');

    if (fasBlob) {
      try {
        const decoded = atob(fasBlob.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/"));
        const params = new URLSearchParams(decoded.replace(/, /g, "&"));
        
        const extractedMac = params.get("clientmac");
        const extractedToken = params.get("hid");
        const extractedGateway = params.get("gatewayname");
        const extractedIp = params.get("clientip");

        if (extractedMac) setMacAddress(extractedMac);
        if (extractedToken) setRouterToken(extractedToken);
        if (extractedGateway) setGatewayHash(extractedGateway);
        if (extractedIp) setClientIp(extractedIp);
        
        setIsLiveRouter(true);
        console.log("Successfully loaded configurations from MikroTik Router.");
      } catch (e) {
        console.error("FAS Parsing Error, falling back to local demo variables:", e);
      }
    }
  }, []);

  // Text-To-Speech Helper
  const speakText = (text: string) => {
    if ('speechSynthesis' in window) {
      const msg = new SpeechSynthesisUtterance(text);
      msg.rate = 1;
      msg.pitch = 1;
      window.speechSynthesis.speak(msg);
    }
  };

  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
  }, []);

  // Ad Slider Interval
  useEffect(() => {
    if (step !== 'WAITING') return;
    const adInterval = setInterval(() => {
      setAdIndex((prev) => (prev + 1) % DEMO_ADS.length);
    }, 3000);
    return () => clearInterval(adInterval);
  }, [step]);

  // Simulated Payment Completion Polling
  useEffect(() => {
    if (step !== 'WAITING') return;

    const demoPollTimer = setTimeout(() => {
      setStep('CONNECTED');
      speakText("Connected. Welcome to B.H.S WiFi");
      
      setTimeout(() => {
        window.location.href = "http://connectivitycheck.gstatic.com/generate_204";
      }, 2500);
    }, 5000);

    return () => clearTimeout(demoPollTimer);
  }, [step]);

  // --- ACTION HANDLERS ---
  const handleInitiatePayment = () => {
    if (phone.trim().length < 10) {
      alert('Invalid phone number');
      return;
    }

    setIsProcessing(true);

    console.log("Initiating payment with properties:", {
      phone: phone.trim(),
      mac: macAddress,
      pkgId: selectedPkgId,
      gateway: gatewayHash,
      token: routerToken,
      ip: clientIp,
      isLiveRouter
    });

    setTimeout(() => {
      setIsProcessing(false);
      setStep('WAITING');
    }, 1200);
  };

  return (
    <div className="app-container">
      <div className="app-card">
        
        {/* Debug Badge */}
        <div className={`debug-badge ${isLiveRouter ? 'debug-live' : 'debug-demo'}`}>
          ● {isLiveRouter ? `Live Router (${gatewayHash})` : 'Demo Preview Mode'}
        </div>

        {/* --- STEP 1: LOGIN/PLAN SELECTION --- */}
        {step === 'LOGIN' && (
          <>
            <h2 className="app-title">MTANDAO MASHINANI WIFI</h2>
            <div className="app-subhead">Ultra High Speed</div>
            
            <div className="section-label">1. Select Plan</div>
            <div className="pkg-grid">
              {packages.map((pkg) => {
                const speedMbps = pkg.download_rate ? (pkg.download_rate / 1000).toFixed(0) : 'Max';
                const isSelected = selectedPkgId === pkg.id;
                
                return (
                  <div 
                    key={pkg.id} 
                    className={`pkg-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedPkgId(pkg.id)}
                  >
                    <div className="pkg-name">{pkg.name}</div>
                    <div className="pkg-price">{pkg.amount}</div>
                    <div className="pkg-speed">{speedMbps} Mbps</div>
                  </div>
                );
              })}
            </div>

            <div className="section-label">2. M-Pesa Number</div>
            <div className="input-container">
              <input 
                type="tel" 
                className="phone-input"
                placeholder="0712 345 678" 
                maxLength={12}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <button 
              className="submit-btn"
              disabled={isProcessing} 
              onClick={handleInitiatePayment}
            >
              {isProcessing ? "Processing..." : "Secure Connect"}
            </button>

            <div className="ad-box">
              <strong>BHS CYBER SERVICES</strong><br />KRA, e-Citizen & Printing.
            </div>
          </>
        )}

        {/* --- STEP 2: WAITING FOR M-PESA PIN --- */}
        {step === 'WAITING' && (
          <>
            <div className="loader"></div>
            <div className="status-text">Verifying Payment</div>
            <p className="sub-text">Enter your M-Pesa PIN on your phone to complete connection.</p>
            
            <div className="ad-container">
              <div className="ad-slide-active">
                <strong>{DEMO_ADS[adIndex].title}</strong><br />{DEMO_ADS[adIndex].desc}
              </div>
            </div>
          </>
        )}

        {/* --- STEP 3: SUCCESSFUL REDIRECT --- */}
        {step === 'CONNECTED' && (
          <>
            <div className="status-text connected">Connected!</div>
            <p className="sub-text">Redirecting you now...</p>
          </>
        )}

      </div>
    </div>
  );
};

export default App;