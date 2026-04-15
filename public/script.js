document.addEventListener('DOMContentLoaded', () => {

    // Stavové proměnné (co uživatel vybral)
    let currentCategory = 'notebook';
    let currentPricePref = 'normal';

    // UI Elementy
    const catBtns = document.querySelectorAll('.cat-btn');
    const priceBtns = document.querySelectorAll('.price-btn');
    const productIcon = document.getElementById('product-icon');
    const imageContainer = document.getElementById('product-image-container');
    const aiResponseContent = document.getElementById('ai-response-content');
    const aiLoader = document.getElementById('ai-loader');
    
    // Ikony (jen pro ilustrativní zobrazení k dané kategorii)
    const icons = {
        'notebook': 'https://img.icons8.com/color/192/000000/laptop--v1.png',
        'mobilní telefon': 'https://img.icons8.com/color/192/000000/iphone.png',
        'stolní PC': 'https://img.icons8.com/color/192/000000/workstation.png',
        'tablet': 'https://img.icons8.com/color/192/000000/ipad.png'
    };

    // Změna kategorie
    catBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            catBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentCategory = e.target.dataset.cat;
            productIcon.src = icons[currentCategory];
        });
    });

    // Změna cenové hladiny
    priceBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            priceBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentPricePref = e.target.dataset.pref;
        });
    });

    // Akce: Najetí myší !!
    let isFetching = false;
    imageContainer.addEventListener('mouseenter', async () => {
        if (isFetching) return;
        isFetching = true;
        
        // Zobrazit loader a schovat text
        aiResponseContent.innerHTML = '';
        aiLoader.classList.remove('hidden');

        try {
            const res = await fetch('/api/evaluate-hover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category: currentCategory, pricePref: currentPricePref })
            });
            const data = await res.json();
            
            aiLoader.classList.add('hidden');

            if (data.success) {
                // Získáme přesný název hardwaru pro vytvoření 100% fungujícího odkazu
                const nameMatch = data.text.match(/Název:\s*(.+)/);
                const queryTerm = nameMatch ? encodeURIComponent(nameMatch[1].trim()) : '';
                const searchLink = queryTerm ? `<br><br><strong style="color: #c084fc;">🛒 Kde spolehlivě koupit:</strong> <a href="https://www.heureka.cz/?h%5Bfraze%5D=${queryTerm}" target="_blank" style="color: #60a5fa; text-decoration: underline;">Prohledat nezávisle na Heureka.cz</a>` : '';

                // Hezky obarvíme odpověď
                let text = data.text.replace(/Název:/g, '<strong style="color: #38bdf8;">Název:</strong>')
                                      .replace(/Cena:/g, '<strong style="color: #fbbf24;">Cena:</strong>')
                                      .replace(/Benchmark:/g, '<strong style="color: #f43f5e;">🏆 Žebříčkové skóre:</strong>')
                                      .replace(/Parametry:/g, '<strong style="color: #38bdf8;">Parametry:</strong>')
                                      .replace(/Komentář:/g, '<strong style="color: #818cf8;">Komentář:</strong>')
                                      .replace(/FPS:/g, '<strong style="color: #4ade80;">Herní výkon (FPS):</strong>');
                
                // Připojíme generovaný spolehlivější link nakonec
                text += searchLink;
                
                aiResponseContent.innerHTML = text;
            } else {
                aiResponseContent.innerHTML = `<span class="error-text">Chyba systému: ${data.error}</span>`;
            }

            // Po zobrazení hardwaru chceme automaticky aktualizovat historii z DB
            loadHistory();

        } catch (err) {
            aiLoader.classList.add('hidden');
            aiResponseContent.innerHTML = `<span class="error-text">Nepodařilo se připojit k serveru.</span>`;
        }

        setTimeout(() => { isFetching = false; }, 2000); // Cooldown 2s
    });

    // Vyhledávání specifického produktu
    const searchBtn = document.getElementById('search-btn');
    const searchInput = document.getElementById('search-input');
    const searchResult = document.getElementById('search-result');

    searchBtn.addEventListener('click', async () => {
        const query = searchInput.value.trim();
        if (!query) return;

        searchResult.innerHTML = '<em>Generuji analýzu produktu, čekejte prosím...</em>';
        
        try {
            const res = await fetch('/api/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query })
            });
            const data = await res.json();
            
            if (data.success) {
                // Připravíme profesionální odkaz na srovnávač cen Heureka
                const queryEncoded = encodeURIComponent(query);
                const heurekaLink = `<br><br><strong style="color: #c084fc;">📊 Srovnání cen a nákup:</strong> <a href="https://www.heureka.cz/?h%5Bfraze%5D=${queryEncoded}" target="_blank" style="color: #60a5fa; text-decoration: underline;">Podívat se na Heureku</a>`;
                
                // Formátování od AI pro hezčí vzhled
                let formattedText = data.text.replace(/Hodnocení:/g, '<strong style="color: #38bdf8;">Hodnocení:</strong>')
                                             .replace(/Alternativa:/g, '<strong style="color: #4ade80;">💡 Tip na lepší alternativu:</strong>');
                
                searchResult.innerHTML = formattedText + heurekaLink;
                searchInput.value = ''; // Vyčištění po úspěchu
            } else {
                // Pokus vulgárního vyhledávání
                searchResult.innerHTML = `<span class="error-text">❌ ${data.error}</span>`;
            }

            loadHistory();
        } catch (err) {
            searchResult.innerHTML = '<span class="error-text">Došlo k chybě při vyhledávání.</span>';
        }
    });

    // Spouštět to i Entrem
    searchInput.addEventListener('keyup', (e) => {
        if(e.key === 'Enter') searchBtn.click();
    });

    // Načítání a aktualizace panelu historie
    const refreshBtn = document.getElementById('refresh-history-btn');
    const viewList = document.getElementById('viewed-history-list');
    const searchList = document.getElementById('searched-history-list');

    async function loadHistory() {
        try {
            const res = await fetch('/api/history');
            const data = await res.json();

            if (data.success) {
                viewList.innerHTML = data.viewed.map(item => {
                    const price = item.price_preference === 'levnější' ? '(Levný)' : item.price_preference === 'dražší' ? '(Prémiový)' : '(Běžný)';
                    const pName = item.product_name || 'Načítání názvu...';
                    const link = `https://www.heureka.cz/?h%5Bfraze%5D=${encodeURIComponent(pName)}`;
                    
                    return `<li class="history-item">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <span>👀 <strong>${item.category}</strong> ${price} <br><small>${new Date(item.created_at).toLocaleTimeString()}</small></span>
                            <span style="font-size: 0.75rem; color: #60a5fa; border: 1px solid rgba(96,165,250,0.3); padding: 2px 6px; border-radius: 4px;">▼ Info</span>
                        </div>
                        <div class="history-tooltip">
                            <strong>${pName}</strong>
                            <a href="${link}" target="_blank">🛒 Hledat na Heurece</a>
                        </div>
                    </li>`;
                }).join('');

                searchList.innerHTML = data.searches.map(item => {
                    return `<li style="${item.is_vulgar ? 'border-left-color: red; opacity: 0.6;' : ''}">
                        🔍 ${item.search_query.substring(0, 30)}...
                        ${item.is_vulgar ? '<b style="color:red">[Blokováno]</b>' : ''}
                    </li>`;
                }).join('');
            }
        } catch (err) {
            console.error('Failed to update history', err);
        }
    }

    refreshBtn.addEventListener('click', loadHistory);

    // Řízení okýnek historie pomocí kliknutí (místo pouhého najetí myší)
    document.addEventListener('click', (e) => {
        const item = e.target.closest('.history-item');
        
        // Kliknutím jinam vždycky zavřít všechna otevřená okénka
        document.querySelectorAll('.history-item.active').forEach(activeItem => {
            if (activeItem !== item) {
                activeItem.classList.remove('active');
            }
        });

        // Kliknutím na položku rozbalíme dané okénko (pokud jsme neklikli už na samotný link a nejdeme pryč)
        if (item && e.target.tagName !== 'A') {
            item.classList.toggle('active');
        }
    });

    // Prvotní načtení dat z DB
    loadHistory();
});
