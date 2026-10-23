const {test,expect}=require('@playwright/test');

test('fresh PWA loads token login without access to real sessions',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('/');
  await expect(page.locator('#loginTitle')).toHaveText('Acceso local');
  await expect(page.locator('#tokenInput')).toBeVisible();
  await expect(page.locator('#loginBtn')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-view','loginView');
  const dimensions=await page.evaluate(()=>({
    screenWidth:document.documentElement.clientWidth,
    overflowWidth:document.documentElement.scrollWidth,
    submitHeight:document.querySelector('#loginBtn').getBoundingClientRect().height
  }));
  expect(dimensions.overflowWidth).toBeLessThanOrEqual(dimensions.screenWidth+2);
  expect(dimensions.submitHeight).toBeGreaterThanOrEqual(40);
  expect(errors).toEqual([]);
});

test('rejects invalid bearer token and stays in login view',async({page})=>{
  await page.goto('/');
  await page.locator('#tokenInput').fill('not-a-real-token');
  await page.locator('#loginBtn').click();
  await expect(page.locator('#loginErr')).not.toBeEmpty();
  await expect(page.locator('body')).toHaveAttribute('data-view','loginView');
});

test('public health is minimal while private API endpoints deny anonymous use',async({request})=>{
  const health=await request.get('/api/health');
  expect(health.ok()).toBeTruthy();
  const data=await health.json();
  expect(data).toMatchObject({ok:true,mspReady:false});
  expect(data).not.toHaveProperty('serverInfo');
  expect((await request.get('/api/push/key')).status()).toBe(401);
  expect((await request.get('/api/events?sessionId=e2e')).status()).toBe(401);
});
