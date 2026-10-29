import java.util.Base64;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.*;
public class OrganizerCryptoCrossCheck {
  public static void main(String[] args) throws Exception {
    byte[] salt=Base64.getDecoder().decode(args[0]);
    byte[] iv=Base64.getDecoder().decode(args[1]);
    byte[] ciphertext=Base64.getDecoder().decode(args[2]);
    PBEKeySpec spec = new PBEKeySpec("interoperability-test-key-2026".toCharArray(),salt,310000,256);
    byte[] secret=SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
    Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
    cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(secret,"AES"),new GCMParameterSpec(128,iv));
    cipher.updateAAD("muse-remote-organizer-v1".getBytes(StandardCharsets.UTF_8));
    String plain=new String(cipher.doFinal(ciphertext),StandardCharsets.UTF_8);
    if(!plain.contains("Interoperable 2026") || !plain.contains("p1")) throw new RuntimeException("Data mismatch");
    System.out.println("WEBCRYPTO_TO_JAVA_AES256_GCM=PASS");
  }
}
