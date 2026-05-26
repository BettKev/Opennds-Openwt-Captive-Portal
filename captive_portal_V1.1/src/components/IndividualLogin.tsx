// IndividualLogin.tsx
import React, { useState } from 'react';

interface IndividualLoginProps {
  onBack: () => void;
}

const IndividualLogin: React.FC<IndividualLoginProps> = ({ onBack }) => {
  const [coupon, setCoupon] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);

  // Sample WiFi packages
  const packages = [
    { id: 'p1', name: '1 Hour Eco', price: 'Ksh 10', speed: 'Up to 3Mbps' },
    { id: 'p2', name: '24 Hour Pass', price: 'Ksh 50', speed: 'Up to 5Mbps' },
    { id: 'p3', name: '7 Day Unlimited', price: 'Ksh 300', speed: 'Up to 5Mbps' },
  ];

  const handleMpesaPayment = () => {
    if (!selectedPackage) {
      alert('Please select a WiFi package first.');
      return;
    }
    alert(`Initiating M-Pesa STK Push for ${selectedPackage}...`);
    // Your M-Pesa API trigger logic goes here
  };

  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
      <h2>Individual Access Portal</h2>
      <button onClick={onBack} style={{ marginBottom: '15px', cursor: 'pointer' }}>← Back</button>

      {/* Coupon Section */}
      <div style={{ backgroundColor: '#f9f9f9', padding: '15px', borderRadius: '8px', marginBottom: '20px' }}>
        <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Have a Coupon Code?</label>
        <div style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            placeholder="Enter coupon code" 
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}
          />
          <button style={{ padding: '8px 15px', backgroundColor: '#0056b3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Activate
          </button>
        </div>
      </div>

      {/* M-Pesa Package Section */}
      <h3>Select a Package to Pay via M-Pesa</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
        {packages.map((pkg) => (
          <div 
            key={pkg.id}
            onClick={() => setSelectedPackage(pkg.name)}
            style={{
              padding: '12px',
              border: selectedPackage === pkg.name ? '2px solid #28a745' : '1px solid #ddd',
              backgroundColor: selectedPackage === pkg.name ? '#e8f5e9' : 'white',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
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

      <button 
        onClick={handleMpesaPayment}
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
        Pay with M-Pesa
      </button>
    </div>
  );
};

export default IndividualLogin;