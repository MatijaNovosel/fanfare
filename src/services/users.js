import firebase from "src/boot/firebase";
import {
  range,
  sample,
  readDocuments,
  checkUsernamePattern,
  generateGuid
} from "src/utils/helpers";
import store from "src/store/index";

class UserService {
  constructor() {
    this.userCollection = firebase.firestore().collection("/users");
  }

  async getAll() {
    const users = await this.chatsCollection.get();
    const retVal = [];
    users.forEach((snapshot) => {
      const data = snapshot.data();
      retVal.push({
        username: data.username,
        email: data.email
      });
    });
    return retVal;
  }

  async addUser(user) {
    await this.userCollection.doc(user.id).set({
      username: user.username,
      email: user.email,
      shorthandId: range(6).map(() => sample(range(6)).toString())
    });
  }

  async getDetails(uid) {
    const user = await this.userCollection.doc(uid).get();
    return user.data();
  }

  async searchByUsername(searchQuery) {
    if (checkUsernamePattern(searchQuery)) {
      const username = searchQuery.split("#")[0];

      const storeRef = await store();
      const currentUser = storeRef.getters["user/user"];

      if (username === currentUser.data.username) {
        return [];
      }

      const shorthandId = searchQuery.split("#")[1];

      const res = await readDocuments("users", {
        where: [
          ["username", "==", username],
          ["shorthandId", "==", shorthandId]
        ]
      });

      const users = [];

      res.forEach((r) => {
        users.push(r.data());
      });

      return users;
    }
    return [];
  }

  async uploadProfilePicture(file) {
    const guid = generateGuid();
    const retVal = await firebase.storage().ref(guid).put(file);
    const url = await retVal.ref.getDownloadURL();
    const storeRef = await store();
    const user = storeRef.getters["user/user"];
    const userData = { ...user.data };
    userData.avatarUrl = url;
    await this.userCollection.doc(user.id).set(userData);
    await storeRef.dispatch("user/fetchUser", userData);
  }
}

export default new UserService();
