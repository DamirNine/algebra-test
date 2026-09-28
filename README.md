# Проверочная по алгебре (7–8 класс)

Онлайн-тест: 12 заданий (4 на ФСУ, 4 на линейные уравнения, 4 на устный счёт) из банка на 48 заданий.
Каждый ученик получает свой случайный вариант, а варианты ответов перемешиваются.
Учитель видит все работы по паролю, в том числе тех, кто решает прямо сейчас.

## Подключение базы результатов (Firebase, бесплатно, ~5 минут)

1. Откройте https://console.firebase.google.com и войдите через Google-аккаунт.
2. **Создать проект** → любое имя (например `algebra-test`) → Google Analytics можно отключить → **Создать**.
3. В меню слева: **Build → Realtime Database** → **Create Database** → регион `europe-west1` → **Start in locked mode** → **Enable**.
4. Вкладка **Rules** → замените всё на текст ниже → **Publish**:

   ```json
   {
     "rules": {
       "algebra-test": {
         ".read": true,
         "$sid": {
           ".write": true,
           ".validate": "newData.hasChildren(['name', 'qs'])"
         }
       }
     }
   }
   ```

5. Скопируйте адрес базы со вкладки **Data** (вида `https://algebra-test-xxxx-default-rtdb.europe-west1.firebasedatabase.app`)
   и вставьте его в `config.js` в поле `DB_URL`.

Пока `DB_URL` пуст, сайт работает в пробном режиме: результаты видны только в том же браузере.

## Пароль учителя

Пароль задан хешем в `config.js` (`TEACHER_HASH`). Сменить пароль:

```
node -e "console.log(require('crypto').createHash('sha256').update('НОВЫЙ_ПАРОЛЬ').digest('hex'))"
```

и вставить результат в `TEACHER_HASH`.

## Файлы

- `questions.js` — банк заданий (формулировки, варианты, подсказки)
- `app.js` — логика ученика и учителя
- `config.js` — адрес базы, пароль, число заданий на раздел
- `tools/verify.js` — проверка банка: `node tools/verify.js` (в каждом задании ровно один верный вариант)
