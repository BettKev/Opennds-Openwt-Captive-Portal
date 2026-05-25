import React, { useState, useEffect } from 'react';
import type { Package } from '../App';

interface LoginCardProps {
  macAddress: string;
  onPaymentInitiated: (checkoutId: string) => void;
}

type ClientType = 'individual' | 'business';

const LoginCard: React.FC<LoginCardProps> = ({ macAddress, onPaymentInitiated }) => {
  const [clientType, setClientType] = useState<ClientType>('individual');
  const [packages, setPackages] = useState<Package[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState<string>('');
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  
  // Enterprise Custom Contexts
  const [businessName, setBusinessName] = useState<string>('');
  const [accountRef, setAccountRef] = useState<string>('');
  
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const mockPackages: Package[] = [
      { id: '1', name: 'Bronze Plan', amount: 10, download_rate: 3000, duration_hours: 1 },
      { id: '2', name: 'Silver Plan', amount: 20, download_rate: 5000, duration_hours: 3 },
      { id: '3', name: 'Gold Speed', amount: 50, download_rate: 10000, duration_hours: 12 },
    ];
    setPackages(mockPackages);
    if (mockPackages.length > 0) setSelectedPkgId(mockPackages[0].id);
  }, []);

  const handlePayment = async () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    }

    const trimmedPhone = phoneNumber.trim();
    if (trimmedPhone.length < 10) {
      alert('Invalid phone number format provided.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        phone: trimmedPhone,
        mac: macAddress,
        pkg: selectedPkgId,
        client_type: clientType,
      });

      if (clientType === 'business') {
        params.append('business_name', businessName);
        params.append('account_reference', accountRef);
      }

      const response = await fetch(`/initiate-stk?${params.toString()}`);
      const data = await response.json();

      if (data.success && data.checkout_id) {
        onPaymentInitiated(data.checkout_id);
      } else {
        setError(data.error || 'STK Push Initiation Failed');
        setLoading(false);
      }
    } catch (err) {
      setError('Communication loss during payment request.');
      setLoading(false);
    }
  };

  return (
    <div className="login-card" id="captive-auth-card">
      <h2 className="main-title">BHS WIFI</h2>
      <div className="sub-tagline">Ultra High Speed</div>

      {/* Segment Switch Engine */}
      <div className="toggle-wrapper">
        <button
          onClick={() => setClientType('individual')}
          className={`toggle-btn ${clientType === 'individual' ? 'active' : ''}`}
        >
          Individual
        </button>
        <button
          onClick={() => setClientType('business')}
          className={`toggle-btn ${clientType === 'business' ? 'active' : ''}`}
        >
          Business Client
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="section-label">1. Select Plan</div>
      <div className="packages-grid">
        {packages.map((pkg) => {
          const speed = pkg.download_rate ? (pkg.download_rate / 1000).toFixed(0) : 'Max';
          const isSelected = selectedPkgId === pkg.id;
          return (
            <div
              key={pkg.id}
              onClick={() => setSelectedPkgId(pkg.id)}
              className={`package-item ${isSelected ? 'selected' : ''}`}
            >
              <span className="package-name">{pkg.name}</span>
              <span className="package-amount">
                {pkg.amount}<span className="package-currency">/-</span>
              </span>
              <span className="package-badge">{speed} Mbps</span>
            </div>
          );
        })}
      </div>

      {clientType === 'business' && (
        <div className="business-fields-wrapper">
          <div className="section-label">Corporate Details</div>
          <div className="input-group">
            <input
              type="text"
              placeholder="Company / Business Name"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="text-input"
              style={{ marginBottom: '8px' }}
            />
            <input
              type="text"
              placeholder="M-Pesa Business Account Ref"
              value={accountRef}
              onChange={(e) => setAccountRef(e.target.value)}
              className="text-input"
            />
          </div>
        </div>
      )}

      <div className="section-label">2. M-Pesa Number</div>
      <div className="input-group">
        <input
          type="tel"
          placeholder="0712 345 678"
          maxLength={12}
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          className="phone-input"
        />
      </div>

      <button onClick={handlePayment} disabled={loading} className="submit-btn">
        {loading ? 'Processing...' : 'Secure Connect'}
      </button>

      <div className="card-footer">
        <strong>BHS CYBER SERVICES</strong><br />
        KRA, e-Citizen & Printing.
      </div>
    </div>
  );
};

export default LoginCard;