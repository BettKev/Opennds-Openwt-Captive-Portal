import React, { useState } from 'react';

interface CorporateLoginProps {
  onBack: () => void;
}

interface Coupon {
  code: string;
  packageType: string;
  status: 'Active';
}

type CorporateStep = 'LOGIN' | 'PORTAL';

const CorporateLogin: React.FC<CorporateLoginProps> = ({ onBack }) => {
  // Authentication & View States
  const [accessCode, setAccessCode] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [currentStep, setCurrentStep] = useState<CorporateStep>('LOGIN');

  // Account Status & Payment States
  const [isAccountActive, setIsAccountActive] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Voucher Database state
  const [generatedCoupons, setGeneratedCoupons] = useState<Coupon[]>([]);

  // Sample Matching WiFi Packages
  const packages = [
    { id: 'p1', name: '1 Hour Eco', price: 'Ksh 10', speed: 'Up to 3Mbps' },
    { id: 'p2', name: '24 Hour Pass', price: 'Ksh 50', speed: 'Up to 5Mbps' },
    { id: 'p3', name: '7 Day Unlimited', price: 'Ksh 300', speed: 'Up to 5Mbps' },
  ];

  // --- LOGIC 1: Simple Token Verification ---
  const handleCorporateLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (accessCode.trim().toLowerCase() === 'demo' || accessCode.trim().toUpperCase() === 'SAFARICOM') {
      setCompanyName(accessCode.toUpperCase() === 'SAFARICOM' ? 'Safaricom PLC' : 'Acme Corp');
      setCurrentStep('PORTAL');
    } else {
      alert('Invalid Corporate Token. (Hint: Use "demo" or "safaricom" to test)');
    }
  };

  // --- LOGIC 2: Corporate M-Pesa Package Payment ---
  const handleCorporatePayment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackage) {
      alert('Please select a WiFi package first.');
      return;
    }
    if (!phoneNumber.match(/^(?:254|\+254|0)?(7|1)\d{8}$/)) {
      alert('Please enter a valid Safaricom phone number.');
      return;
    }

    setIsProcessing(true);

    // Simulate backend M-Pesa STK verification
    setTimeout(() => {
      setIsProcessing(false);
      setIsAccountActive(true); // Account is now flagged active!
      alert(`🎉 Payment for ${selectedPackage} successful! Your Corporate Engine is now ACTIVE.`);
    }, 2500);
  };

  // --- LOGIC 3: Guarded Coupon Generation ---
  const generateCouponCode = () => {
    if (!isAccountActive) return; // Guard clause

    const uniqueCode = "CORP-" + Math.random().toString(36).substring(2, 7).toUpperCase();
    const newCoupon: Coupon = {
      code: uniqueCode,
      packageType: selectedPackage || 'Corporate Tier',
      status: 'Active'
    };

    setGeneratedCoupons([newCoupon, ...generatedCoupons]);
  };

  return (
    <div style={{ maxWidth: '420px', margin: '20px auto', padding: '20px', border: '1px solid #ddd', borderRadius: '12px', fontFamily: 'sans-serif', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      
      {/* 1. INITIAL LOGIN WINDOW */}
      {currentStep === 'LOGIN' && (
        <div style={{ textAlign: 'left' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
            <button onClick={onBack} style={{ padding: '6px 12px', cursor: 'pointer', border: '1px solid #ccc', borderRadius: '4px', background: '#fff' }}>← Back</button>
            <h2 style={{ margin: '0 0 0 15px', fontSize: '20px', color: '#17a2b8' }}>Corporate Access Portal</h2>
          </div>

          <form onSubmit={handleCorporateLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' }}>Corporate Access Code</label>
              <input 
                type="text" 
                required
                placeholder="Try typing 'demo'" 
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
              />
            </div>
            <button type="submit" style={{ padding: '12px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
              Verify & Log In
            </button>
          </form>
        </div>
      )}

      {/* 2. CORPORATE ACCOUNT SCREEN */}
      {currentStep === 'PORTAL' && (
        <div style={{ textAlign: 'left' }}>
          
          {/* Header & Account Badging */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
            <div>
              <h3 style={{ margin: 0, color: '#333' }}>{companyName}</h3>
              <span style={{ 
                fontSize: '11px', 
                fontWeight: 'bold', 
                padding: '2px 8px', 
                borderRadius: '12px', 
                backgroundColor: isAccountActive ? '#d4edda' : '#f8d7da',
                color: isAccountActive ? '#155724' : '#721c24'
              }}>
                Status: {isAccountActive ? '🟢 Active' : '🔴 Inactive'}
              </span>
              {isAccountActive && (
                <small style={{ display: 'block', color: '#666', marginTop: '4px' }}>
                  Plan: <b>{selectedPackage}</b>
                </small>
              )}
            </div>
            <button 
              onClick={() => { setCurrentStep('LOGIN'); setIsAccountActive(false); setGeneratedCoupons([]); setSelectedPackage(null); setPhoneNumber(''); }} 
              style={{ padding: '4px 8px', fontSize: '11px', color: '#dc3545', background: 'none', border: '1px solid #dc3545', borderRadius: '4px', cursor: 'pointer' }}
            >
              Sign Out
            </button>
          </div>

          {/* CONDITIONALLY RENDER BILLING INTERFACE IFF INACTIVE */}
          {!isAccountActive ? (
            <>
              {/* Package Selection Flow */}
              <h4 style={{ margin: '0 0 10px 0', fontSize: '14px' }}>Select a Corporate Package Tier:</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '15px' }}>
                {packages.map((pkg) => (
                  <div 
                    key={pkg.id}
                    onClick={() => !isProcessing && setSelectedPackage(pkg.name)}
                    style={{
                      padding: '10px 12px',
                      border: selectedPackage === pkg.name ? '2px solid #17a2b8' : '1px solid #ddd',
                      backgroundColor: selectedPackage === pkg.name ? '#e3f2fd' : 'white',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <strong style={{ display: 'block', fontSize: '14px' }}>{pkg.name}</strong>
                      <small style={{ color: '#666', fontSize: '11px' }}>{pkg.speed}</small>
                    </div>
                    <span style={{ fontWeight: 'bold', color: '#17a2b8', fontSize: '14px' }}>{pkg.price}</span>
                  </div>
                ))}
              </div>

              {/* M-Pesa Authorization Row */}
              <form onSubmit={handleCorporatePayment} style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>Safaricom Phone Number</label>
                    <input 
                      type="tel" 
                      required
                      placeholder="e.g. 0712345678"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      style={{ width: '90%', padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={isProcessing}
                    style={{ padding: '9px 15px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    {isProcessing ? 'Verifying...' : 'Pay with M-Pesa'}
                  </button>
                </div>
              </form>
            </>
          ) : (
            /* DISPLAY ONLY ENGINE WORKSPACE IFF ACTIVE */
            <div style={{ backgroundColor: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #dee2e6', marginBottom: '15px' }}>
              <button 
                onClick={generateCouponCode}
                style={{
                  width: '100%',
                  padding: '12px',
                  backgroundColor: '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  fontSize: '15px',
                  cursor: 'pointer'
                }}
              >
                🎟️ Generate Shared Coupon Code
              </button>

              {/* Live Generated Vouchers */}
              {generatedCoupons.length > 0 && (
                <div style={{ marginTop: '15px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 'bold', color: '#555', display: 'block', marginBottom: '6px' }}>Generated Employee Coupons:</label>
                  <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {generatedCoupons.map((coupon, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#e8f5e9', padding: '6px 10px', borderRadius: '4px', border: '1px solid #c8e6c9', fontSize: '13px' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#1b5e20' }}>{coupon.code}</span>
                        <span style={{ fontSize: '11px', color: '#666' }}>{coupon.packageType}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default CorporateLogin;