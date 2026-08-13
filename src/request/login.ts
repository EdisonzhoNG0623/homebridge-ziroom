interface LoginResponse {
  error_code: number;
  error_msg: string;
  data: {
    token: string;
  };
}

export const login = async (account: string, password: string) => {
  let webkit: typeof import('playwright')['webkit'];
  try {
    const playwrightModule = 'playwright';
    ({ webkit } = (await import(/* webpackIgnore: true */ playwrightModule)) as typeof import('playwright'));
  } catch {
    throw new Error('账号密码自动登录需要可选依赖 playwright；请改用 Token，或安装 playwright 和 WebKit');
  }

  const browser = await webkit.launch();
  try {
    const page = await browser.newPage();
    let responseData: LoginResponse | null = null;
    const loginUrl = '**/index.php?r=account%2Flogin%2Flogin';
    await page.route(loginUrl, async (route) => {
      const response = await route.fetch();
      responseData = (await response.json()) as LoginResponse;
      await route.fulfill({ response });
    });
    await page.goto('https://passport.ziroom.com/login.html');
    await page.waitForSelector('input#user_name');
    await page.fill('input#user_name', account);
    await page.fill('input#user_pas', password);
    await page.click('#J-m-isSeven');
    await page.click('#loginConfirmHook');
    await Promise.all([page.waitForResponse(loginUrl), page.click('#login_button')]);

    const loginResponse = responseData as LoginResponse | null;
    if (loginResponse?.error_code === 0) {
      return loginResponse.data?.token;
    }
    throw new Error(loginResponse?.error_msg ?? '自如登录失败');
  } finally {
    await browser.close();
  }
};
