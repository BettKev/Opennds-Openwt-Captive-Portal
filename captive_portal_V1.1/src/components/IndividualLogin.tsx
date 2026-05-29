import React, { useState, useEffect } from 'react';

interface IndividualLoginProps {
  onBack: () => void;
}

// Simulated Router Gateway URL (Captive Portal endpoint)
const ROUTER_GATEWAY_URL = "http://10.0.0.1/login"; 

type AuthStep = 'IDLE' | 'STK_PUSH_SENT' | 'VERIFYING' | 'ROUTER_AUTH' | 'SUCCESS';

const IndividualLogin: React.FC<IndividualLoginProps> = ({ onBack }) => {
  const [coupon, setCoupon] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<{ id: string; name: string; price: string } | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  
  // Simulation Flow States
  const [authStep, setAuthStep] = useState<AuthStep>('IDLE');
  const [statusMessage, setStatusMessage] = useState('');
  const [countdown, setCountdown] = useState(10); // Simulated wait for STK Push

  // Sample WiFi packages
  const packages = [
    { id: 'p1', name: '1 Hour Eco', price: 'Ksh 10', speed: 'Up to 3Mbps' },
    { id: 'p2', name: '24 Hour Pass', price: 'Ksh 50', speed: 'Up to 5Mbps' },
    { id: 'p3', name: '7 Day Unlimited', price: 'Ksh 300', speed: 'Up to 5Mbps' },
  ];

  // Simulated Countdown timer for Safaricom STK response
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (authStep === 'STK_PUSH_SENT' && countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    } else if (authStep === 'STK_PUSH_SENT' && countdown === 0) {
      // Auto-trigger verification when countdown ends
      verifyPayment();
    }
    return () => clearTimeout(timer);
  }, [authStep, countdown]);

  // --- LOGIC 1: Handle M-Pesa Payment Simulation ---
  const handleMpesaPayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackage) {
      alert('Please select a WiFi package first.');
      return;
    }
    if (!phoneNumber.match(/^(?:254|\+254|0)?(7|1)\d{8}$/)) {
      alert('Please enter a valid Safaricom phone number.');
      return;
    }

    setAuthStep('STK_PUSH_SENT');
    setStatusMessage(`STK Push sent to ${phoneNumber}. Please check your phone and enter your PIN.`);
    setCountdown(10); 
  };

  const verifyPayment = () => {
    setAuthStep('VERIFYING');
    setStatusMessage('Checking M-Pesa transaction ledger...');

    // Simulate backend API checking callback from Safaricom Daraja
    setTimeout(() => {
      // Mock Success state generation
      const mockGeneratedCode = "WIFI-" + Math.random().toString(36).substring(2, 8).toUpperCase();
      authenticateWithRouter(mockGeneratedCode);
    }, 2500);
  };

  // --- LOGIC 2: Handle Coupon Activation Simulation ---
  const handleCouponActivate = () => {
    if (!coupon.trim()) {
      alert('Please enter a coupon code.');
      return;
    }

    setAuthStep('VERIFYING');
    setStatusMessage('Validating coupon code with backend database...');

    setTimeout(() => {
      if (coupon.toLowerCase() === 'freeinternet' || coupon.toLowerCase() === 'safari') {
        authenticateWithRouter(coupon.toUpperCase());
      } else {
        alert('Invalid coupon code. Try using "FREEINTERNET" for the simulation.');
        setAuthStep('IDLE');
        setStatusMessage('');
      }
    }, 2000);
  };

  // --- LOGIC 3: Network / Router Authentication Bridge ---
  const authenticateWithRouter = (accessCode: string) => {
    setAuthStep('ROUTER_AUTH');
    setStatusMessage(`Success! Code acquired: ${accessCode}. Authenticating device MAC address on router gateway...`);

    // Simulating POSTing data to the network NAS controller
    setTimeout(() => {
      setAuthStep('SUCCESS');
      setStatusMessage('You are now connected to the High-Speed WiFi Network!');
      
      /* In production, you would drop out of React here and force a browser redirect:
         window.location.href = `${ROUTER_GATEWAY_URL}?username=${accessCode}&password=${accessCode}`;
      */
    }, 3000);
  };

  const resetSimulation = () => {
    setAuthStep('IDLE');
    setStatusMessage('');
    setCoupon('');
    setSelectedPackage(null);
  };

  return (
    <div style={{ maxWidth: '450px', margin: '20px auto', padding: '20px', border: '1px solid #ddd', borderRadius: '12px', fontFamily: 'sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      
      {/* Simulation Banner Info */}
      <div style={{ backgroundColor: '#fff3cd', color: '#856404', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', marginBottom: '15px', fontWeight: 'bold' }}>
        Simulation State: <span style={{ color: '#d39e00' }}>{authStep}</span>
      </div>

      {authStep === 'IDLE' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
            <button onClick={onBack} style={{ padding: '6px 12px', cursor: 'pointer', border: '1px solid #ccc', borderRadius: '4px', background: '#fff' }}>← Back</button>
            <h2 style={{ margin: '0 0 0 15px', fontSize: '20px' }}>Individual Access Portal</h2>
          </div>

          {/* Coupon Section */}
          <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #eee' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' }}>Have a Coupon Code?</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                placeholder="Try 'FREEINTERNET'" 
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              <button 
                onClick={handleCouponActivate}
                style={{ padding: '8px 15px', backgroundColor: '#0056b3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Activate
              </button>
            </div>
          </div>

          {/* M-Pesa Package Section */}
          <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Select a Package to Pay via M-Pesa</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            {packages.map((pkg) => (
              <div 
                key={pkg.id}
                onClick={() => setSelectedPackage(pkg)}
                style={{
                  padding: '12px',
                  border: selectedPackage?.id === pkg.id ? '2px solid #28a745' : '1px solid #ddd',
                  backgroundColor: selectedPackage?.id === pkg.id ? '#e8f5e9' : 'white',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  transition: '0.2s'
                }}
              >
                <div>
                  <strong style={{ display: 'block' }}>{pkg.name}</strong>
                  <small style={{ color: '#666' }}>{pkg.speed}</small>
                </div>
                <span style={{ fontWeight: 'bold', color: '#28a745' }}>{pkg.price}</span>
              </div>
            ))}
          </div>

          {/* Phone Number Input and Pay Trigger */}
          <form onSubmit={handleMpesaPayment}>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' }}>Safaricom Phone Number</label>
              <input 
                type="tel" 
                required
                placeholder="e.g., 0712345678" 
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                style={{ width: '94%', padding: '10px', borderRadius: '6px', border: '1px solid #ccc' }}
              />
            </div>

            <button 
              type="submit"
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                fontWeight: 'bold',
                fontSize: '16px',
                cursor: 'pointer'
              }}
            >
              Pay {selectedPackage ? selectedPackage.price : ''} with M-Pesa
            </button>
          </form>
        </>
      ) : (
        /* Status Display Dashboard (Simulation Feedback) */
        <div style={{ textAlign: 'center', padding: '30px 10px' }}>
          
          {/* Animated Spinner/Icons depending on state */}
          {authStep !== 'SUCCESS' ? (
            <div style={{ marginBottom: '20px' }}>
              <div style={{
                display: 'inline-block',
                width: '40px',
                height: '40px',
                border: '4px solid #f3f3f3',
                borderTop: '4px solid ' + (authStep === 'STK_PUSH_SENT' ? '#ffc107' : '#007bff'),
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }} />
              <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <div style={{ fontSize: '50px', color: '#28a745', marginBottom: '20px' }}>🎉</div>
          )}

          <p style={{ fontWeight: 'bold', fontSize: '16px', color: '#333', lineHeight: '1.5' }}>
            {statusMessage}
          </p>

          {authStep === 'STK_PUSH_SENT' && (
            <div style={{ marginTop: '15px' }}>
              <span style={{ fontSize: '14px', color: '#666' }}>Simulating Safaricom Callback timeout in: <b>{countdown}s</b></span>
              <br />
              <button 
                onClick={verifyPayment}
                style={{ marginTop: '15px', padding: '8px 12px', backgroundColor: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
              >
                Simulate PIN Entry (Instantly Verify)
              </button>
            </div>
          )}

          {authStep === 'SUCCESS' && (
            <button 
              onClick={resetSimulation}
              style={{ marginTop: '20px', padding: '10px 20px', backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Disconnect & Restart Simulation
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default IndividualLogin;