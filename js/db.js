/**
 * Gerenciador de Banco de Dados Local (IndexedDB) para o Catálogo Hot Wheels
 * Permite armazenamento 100% offline de miniaturas e imagens sem limites de tamanho do localStorage.
 */

const DB_NAME = 'HotWheelsCatalogDB';
const DB_VERSION = 1;
const STORE_NAME = 'cars';

class CatalogDB {
  constructor() {
    this.db = null;
  }

  /**
   * Inicializa o banco de dados IndexedDB e faz o seeding inicial se vazio.
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('segment', 'segment', { unique: false });
        }
      };

      request.onsuccess = async (event) => {
        this.db = event.target.result;
        const count = await this.count();
        if (count === 0) {
          await this._seedInitialData();
        }
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('Erro ao abrir IndexedDB:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Realiza a carga inicial caso o banco esteja vazio
   */
  async _seedInitialData() {
    try {
      const response = await fetch('cars.json');
      if (response.ok) {
        const initialCars = await response.json();
        const formatted = initialCars.map((car, index) => ({
          ...car,
          id: car.id || `car-${Date.now()}-${index}`,
          status: car.status || 'Disponível'
        }));
        await this.bulkAdd(formatted);
        console.log(`[IndexedDB] ${formatted.length} miniaturas carregadas inicialmente.`);
      }
    } catch (e) {
      console.warn('[IndexedDB] Não foi possível carregar cars.json para seeding inicial:', e);
    }
  }

  /**
   * Conta a quantidade de miniaturas salvas
   */
  async count() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Retorna todas as miniaturas
   */
  async getAll() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Busca miniatura por ID
   */
  async getById(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Adiciona uma nova miniatura
   */
  async add(car) {
    return new Promise((resolve, reject) => {
      if (!car.id) {
        car.id = `car-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      }
      if (!car.status) {
        car.status = 'Disponível';
      }
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(car);
      req.onsuccess = () => resolve(car);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Atualiza uma miniatura existente
   */
  async update(car) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(car);
      req.onsuccess = () => resolve(car);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Deleta uma miniatura por ID
   */
  async delete(id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Adiciona múltiplos itens em lote
   */
  async bulkAdd(carsList) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      carsList.forEach((car) => store.put(car));
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Limpa todos os dados do banco
   */
  async clear() {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Restaura o catálogo com os dados de um array ou do arquivo inicial
   */
  async restoreFromData(carsList) {
    await this.clear();
    const formatted = carsList.map((car, index) => ({
      ...car,
      id: car.id || `car-${Date.now()}-${index}`,
      status: car.status || 'Disponível'
    }));
    await this.bulkAdd(formatted);
    return formatted;
  }
}

// Utilitário para comprimir imagens antes de salvar no IndexedDB
const ImageUtils = {
  /**
   * Converte e redimensiona um File/Blob de imagem para uma String Base64 otimizada
   */
  async fileToBase64Optimized(file, maxDimension = 800, quality = 0.85) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        return reject(new Error('Arquivo selecionado não é uma imagem válida.'));
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;

          // Redimensionamento proporcional
          if (width > height) {
            if (width > maxDimension) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            }
          } else {
            if (height > maxDimension) {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Tenta webp com fallback para jpeg
          let dataUrl = canvas.toDataURL('image/webp', quality);
          if (!dataUrl.startsWith('data:image/webp')) {
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('Erro ao carregar a imagem.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Erro ao ler arquivo.'));
      reader.readAsDataURL(file);
    });
  }
};

window.CatalogDB = new CatalogDB();
window.ImageUtils = ImageUtils;
