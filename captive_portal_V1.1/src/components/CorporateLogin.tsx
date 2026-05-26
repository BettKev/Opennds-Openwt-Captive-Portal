// CorporateLogin.tsx
import React, { useState } from 'react';

interface CorporateLoginProps {
  onBack: () => void;
}

const CorporateLogin: React.FC<CorporateLoginProps> = ({ onBack }) => {
  const [accessCode, setAccessCode] = useState('');

  const handleCorporateLogin = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Authenticating corporate code: ${accessCode}`);
    // Your backend authentication logic goes here
  };

  return (
    <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
      <h2>Corporate Access Portal</h2>
      <button onClick={onBack} style={{ marginBottom: '15px', cursor: 'pointer' }}>← Back</button>

      <form onSubmit={handleCorporateLogin} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Corporate Access Code</label>
          <input 
            type="text" 
            required
            placeholder="Enter your company token" 
            value={accessCode}
            onChange={(e) => setAccessCode(e.target.value)}
            style={{ width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }}
          />
        </div>
        
        <button 
          type="submit"
          style={{
            padding: '12px',
            backgroundColor: '#17a2b8',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 'bold',
            cursor: 'pointer'
          }}
        >
          Verify & Connect
        </button>
      </form>
      <p style={{ fontSize: '13px', color: '#666', marginTop: '15px' }}>
        * Corporate access requires a pre-approved token provided by your IT administration.
      </p>
    </div>
  );
};

export default CorporateLogin;