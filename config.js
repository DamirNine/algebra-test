window.CONFIG = {
  // Адрес Firebase Realtime Database (без слеша в конце), например:
  // 'https://algebra-test-12345-default-rtdb.europe-west1.firebasedatabase.app'
  DB_URL: '',

  // Раздел внутри базы, куда пишутся работы этого теста. У другого теста в той же базе — своё имя.
  DB_PATH: 'algebra-test',

  // SHA-256 от пароля учителя. Сменить пароль:
  //   node -e "console.log(require('crypto').createHash('sha256').update('НОВЫЙ_ПАРОЛЬ').digest('hex'))"
  TEACHER_HASH: '39dfc02f6e9fc77c7f511506ac5fc97d09d657b23624aa1bf5ec6ff6d3d060e7',

  // Сколько заданий каждого раздела попадает в вариант
  PER_SECTION: 4
};
