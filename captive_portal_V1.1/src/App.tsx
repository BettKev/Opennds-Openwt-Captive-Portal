// App.tsx
import React, { useState } from 'react';
import IndividualLogin from './components/IndividualLogin';
import CorporateLogin from './components/CorporateLogin';
import './index.css';

const App: React.FC = () => {
  const [currentView, setCurrentView] = useState<'home' | 'individual' | 'corporate'>('home');

  return (
    <div style={{ textAlign: 'center', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>MTANDAO MASHINANI WIFI</h1>

      {/* MAIN HOME VIEW */}
      {currentView === 'home' && (
        <div>
          <p>Welcome to our wifi. Please select a category to proceed.</p>
          <div className="button-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', margin: '20px 0' }}>
            <br></br>
            <p>Click this button if you want to access the wifi as an individual user.</p>
            <button 
              style={{ padding: '12px 24px', fontSize: '16px', width: '220px', cursor: 'pointer', fontWeight: 'bold' }} 
              onClick={() => setCurrentView('individual')}
            >
              Individual User
            </button>
            <br></br>
            <p>Click this button if you are a corporate client.</p>
            <button 
              style={{ padding: '12px 24px', fontSize: '16px', width: '220px', cursor: 'pointer', fontWeight: 'bold' }} 
              onClick={() => setCurrentView('corporate')}
            >
              Corporate Client
            </button>
          </div>
        </div>
      )}

      {/* INDIVIDUAL VIEW */}
      {currentView === 'individual' && (
        <IndividualLogin onBack={() => setCurrentView('home')} />
      )}

      {/* CORPORATE VIEW */}
      {currentView === 'corporate' && (
        <CorporateLogin onBack={() => setCurrentView('home')} />
      )}

      {/* FOOTER */}
      <hr style={{ margin: '30px auto', maxWidth: '500px', borderColor: '#eee' }} />
      <p style={{ fontSize: '14px', color: '#555' }}>By using this wifi, you agree to our terms and conditions.</p>
      <p style={{ fontSize: '14px', fontWeight: 'bold' }}>This network is powered by BHS CYBER CAFE.</p>
      <p style={{ fontSize: '12px', color: '#777' }}>
        Visit our office for more information or contact us via cell 0707759220 or email birirhomesupplies@gmail.com
      </p>
    </div>
  );
};

export default App;