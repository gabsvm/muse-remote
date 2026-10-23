const {defineConfig,devices}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./e2e',
  timeout:20000,
  expect:{timeout:6000},
  retries:0,
  reporter:'list',
  use:{
    baseURL:'http://127.0.0.1:8897',
    browserName:'chromium',
    ...(process.env.PLAYWRIGHT_BROWSER_CHANNEL ? {channel:process.env.PLAYWRIGHT_BROWSER_CHANNEL} : {}),
    trace:'retain-on-failure'
  },
  projects:[
    {name:'desktop',use:{viewport:{width:1200,height:850}}},
    {name:'mobile',use:{...devices['Pixel 7'],viewport:{width:393,height:852}}}
  ],
  webServer:{
    command:'node scripts/qa/mock-bridge.js',
    url:'http://127.0.0.1:8897/api/health',
    reuseExistingServer:false,
    timeout:15000
  }
});
