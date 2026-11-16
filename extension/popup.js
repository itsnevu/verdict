const input = document.getElementById('api');
chrome.storage.sync.get('api').then(({ api }) => { input.value = api || ''; });
document.getElementById('save').onclick = async () => {
  await chrome.storage.sync.set({ api: input.value.trim() });
  document.getElementById('ok').textContent = 'saved';
};
